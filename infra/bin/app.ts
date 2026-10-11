import * as cdk from 'aws-cdk-lib';
import { MealPlannerStack } from '../lib/meal-planner-stack';

// 使い方: cdk synth -c envName=staging|production
// ※ このリポジトリでは「合成（synth）」までしか行わない。cdk deploy は、費用と取り消しにくさがあるため、
//    利用者の別の承認を得てから行う（infrastructure-specification.md「AWS への実際の作成」）。
const app = new cdk.App();
const envName = (app.node.tryGetContext('envName') as string | undefined) ?? 'staging';
if (envName !== 'staging' && envName !== 'production') {
  throw new Error(`envName は staging か production を指定してください（指定: ${envName}）`);
}

new MealPlannerStack(app, `MealPlanner-${envName}`, {
  envName,
  // U7（ログインの失敗の制限）が完成するまでは、本番にも入口の制限を既定で有効にする（NFR3.4）
  publicRestricted: true,
  // 通知先（共有のメール）。実際に作る前に決める
  alarmEmail: (app.node.tryGetContext('alarmEmail') as string | undefined) ?? null,
});
