import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';

export interface MealPlannerStackProps extends cdk.StackProps {
  envName: 'staging' | 'production';
  /** 検証環境の入口の制限（Basic 認証）。U7 が完成するまで本番も true（NFR3.4） */
  publicRestricted: boolean;
  alarmEmail: string | null;
}

/**
 * U1 最小の通し版の AWS 構成（骨組み）。仕様は infrastructure-specification.md。
 *
 * 状態：cdk synth が通る骨組み。実際には作らない。未完成の部分は TODO と理由を書いてある。
 */
export class MealPlannerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MealPlannerStackProps) {
    super(scope, id, props);
    const isProd = props.envName === 'production';

    // ---- ネットワーク：関数とデータベースを私的なサブネットに置く（NFR3.12） ----
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0, // NAT は費用が大きいので使わず、VPC エンドポイントを使う
      subnetConfiguration: [
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpc.addInterfaceEndpoint('SecretsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    });
    // TODO: CloudWatch Logs 用のエンドポイントは Lambda のログ出力には不要（Lambda サービスが送る）。
    //       関数から直接他の AWS API を呼ぶようになったら足す。

    // ---- データベース：PostgreSQL 互換、サーバーレス型。停止しない（下限 0.5）、削除保護あり ----
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      description: 'Aurora (private only)',
      allowAllOutbound: false,
    });
    const db = new rds.DatabaseCluster(this, 'Database', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_4,
      }),
      writer: rds.ClusterInstance.serverlessV2('writer'),
      serverlessV2MinCapacity: 0.5, // 0 にして止めると再開が遅く NFR2.5（3 秒）を守れない
      serverlessV2MaxCapacity: 2,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      defaultDatabaseName: 'mealplanner',
      storageEncrypted: true,
      deletionProtection: true, // スタックを誤って消してもデータベースが消えない
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    // TODO: RDS Proxy（接続の束ね）は常時課金。同時実行を 10 に絞れば不要の見込みなので、
    //       実際に作る前の承認で置くか外すかを決める（OQ2、OQ3）。

    // ---- アプリ本体（全ユニット 1 関数） ----
    const fnSecurityGroup = new ec2.SecurityGroup(this, 'FnSg', { vpc, allowAllOutbound: true });
    dbSecurityGroup.addIngressRule(fnSecurityGroup, ec2.Port.tcp(5432), 'app -> db');
    const appFn = new lambda.Function(this, 'App', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      // TODO: Next.js の成果物をここへ載せる（Lambda Web Adapter 等のコンテナ／zip の方式を選ぶ）。
      //       アプリのローカル動作を優先したため、現時点は応答するだけの仮のコード。
      code: lambda.Code.fromInline(
        "exports.handler = async () => ({ statusCode: 503, body: 'TODO: アプリ本体を配置してください' });",
      ),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(15),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [fnSecurityGroup],
      reservedConcurrentExecutions: isProd ? 10 : 5,
      logRetention: logs.RetentionDays.ONE_MONTH, // 30 日（NFR4.19）
      environment: {
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        // TODO: APP_ORIGIN に配信網（CloudFront）のドメイン（https://...）を渡す。本番では未設定だと状態を変える操作がすべて拒否される
        // 接続情報は Secrets Manager から起動時に読む（NFR3.13）。値そのものは環境変数に入れない
        DB_SECRET_ARN: db.secret!.secretArn,
        // TODO: アプリ側で DB_SECRET_ARN から DATABASE_URL を組み立てる処理を足す（現在は DATABASE_URL を直接読む）
      },
    });
    db.secret!.grantRead(appFn);

    // ---- API の入口 ----
    const api = new apigw.LambdaRestApi(this, 'Api', {
      handler: appFn,
      proxy: true,
      deployOptions: {
        throttlingRateLimit: 20,
        throttlingBurstLimit: 40,
        loggingLevel: apigw.MethodLoggingLevel.ERROR,
      },
    });
    // TODO: 配信網だけが付ける秘密の見出し（X-Origin-Verify）が無いリクエストを拒否する（API の直接アクセスの封じ。
    //       リソースポリシーかオーソライザーで実装する）。

    // ---- 画面の部品（静的ファイル）と配信網 ----
    const assets = new s3.Bucket(this, 'Assets', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const originSecret = new cdk.CfnParameter(this, 'OriginVerifySecret', {
      type: 'String',
      noEcho: true,
      default: 'TODO-change-me-before-deploy',
      description: '配信網が API の入口へ付ける秘密の見出しの値（リポジトリには入れない）',
    });
    const apiOrigin = new origins.RestApiOrigin(api, {
      customHeaders: { 'X-Origin-Verify': originSecret.valueAsString },
    });
    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: apiOrigin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    };
    const cdn = new cloudfront.Distribution(this, 'Cdn', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(assets),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: { '/api/*': apiBehavior, '/healthz': apiBehavior },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // 日本を含む
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      // TODO: HSTS とセキュリティヘッダー（ResponseHeadersPolicy）を付ける。
      // TODO: props.publicRestricted が true のとき、CloudFront Functions で Basic 認証を確認する
      //       （/healthz は例外）。合言葉は Secrets Manager に預ける。
    });
    void props.publicRestricted;

    // ---- 監視：止まった／エラーが増えた（monitoring-design.md） ----
    const topic = new sns.Topic(this, 'Alerts');
    if (props.alarmEmail) topic.addSubscription(new subs.EmailSubscription(props.alarmEmail));
    const action = new cwActions.SnsAction(topic);

    const errorsAlarm = new cw.Alarm(this, 'ServerErrors', {
      alarmDescription: 'サーバー側のエラーが増えた（5 分間に 5 件以上）',
      metric: api.metricServerError({ period: cdk.Duration.minutes(5), statistic: 'Sum' }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });
    errorsAlarm.addAlarmAction(action);
    // TODO: 「リクエスト 20 件以上で 5% 超」の割合のアラーム（math expression）。
    // TODO: 「止まった」アラーム＝ 30 分ごとの /healthz の死活確認（EventBridge + 呼び出し）の 2 回連続の失敗。
    //       呼び出し側の実装が必要なため、骨組みでは未実装。

    new cdk.CfnOutput(this, 'CdnDomain', { value: cdn.distributionDomainName });
  }
}
