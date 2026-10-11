# エンティティ設計：U7 グループとアカウントの管理（account-admin）

技術を決めない設計です。U1 の `entities.md` に**足す・広げる**ものを決めます。正（source of truth）は下の yaml ブロックです。U1 で決めた Account、LoginSession、Household、Member は、ここに書いた属性だけを足します。

## 根拠（Sources）

- [Q1〜Q6] `functional-design-questions.md` の回答（すべて A）
- [scope] `unit-of-work.md` の U7 の節（招待、脱退、アカウント削除、再設定、ログイン失敗の制限、グループ削除の暫定の案）
- [memory] ADR-007（出来事）、ADR-009（退会メンバーは行を残し名前を消す）、契約 C3（出来事）、C5（メール送信の窓口）
- [U1] `skeleton/functional-design/entities.md`（Account、Member、「上流の名前との対応表」で U7 が足すと予告された failedLoginCount、lockedUntil）

## エンティティの定義

```yaml
entities:
  # ---------- U1 のエンティティに足すもの ----------
  - name: Account
    component: Account
    description: U1 の Account に、ログイン失敗の制限と削除の印を足す。
    added_attributes:
      - { name: failedLoginCount, type: integer, required: true, default: 0, min: 0, max: 5, constraints: "パスワードの失敗が続いた回数。成功、またはロック期限の経過、再設定の成功で 0 に戻る（BR50.5、BR50.7）" }
      - { name: lockedUntil, type: datetime, required: false, constraints: "空でなく、現在より後ならロック中（BR50.6）。ロックはアカウント単位" }
      - { name: deletedAt, type: datetime, required: false, constraints: "空でなければ削除済み。削除すると email、passwordDigest を空にする（Account は表示名を持たない。表示名は Member が持つ。BR50.20）。行は ID の参照が宙に浮かないよう残す（ADR-009）" }
    changed_attributes:
      - { name: email, change: "required を false にする（削除済みのとき空）。空でないものは、U1 と同じく大文字小文字を区別せず一意" }
      - { name: passwordDigest, change: "required を false にする（削除済みのとき空）" }
    relationships:
      - { to: PasswordResetToken, cardinality: "1 : 0..n", direction: "Account -> PasswordResetToken" }

  - name: Member
    component: Household
    description: U1 の Member。U7 の脱退とアカウント削除で leftAt を設定し、名前と accountId を消す。新しい属性は足さない。
    state_rules:
      - "有効 = leftAt が空。退会 = leftAt が設定され、displayName と accountId が空（BR50.16）。一度退会した行は、有効に戻さない（BR50.15）"
      - "退会した行の memberId は、Dish.createdBy、PickedItem.memberId などに残り、「退会したメンバー」と表示される（BR2.5）"

  # ---------- U7 で新しく作るもの ----------
  - name: PasswordResetToken
    component: Account
    description: パスワード再設定のリンク 1 本分。リンクの元の値は保存せず、変換値だけを持つ。
    attributes:
      - { name: tokenId, type: id, required: true, unique: true }
      - { name: accountId, type: id, required: true, references: Account.accountId }
      - { name: tokenDigest, type: text, required: true, unique: true, constraints: "推測できないランダムな値（十分に長い）の変換値。元の値は保存しない（BR50.3）" }
      - { name: issuedAt, type: datetime, required: true }
      - { name: expiresAt, type: datetime, required: true, constraints: "issuedAt の 60 分後（Q3 A）" }
      - { name: usedAt, type: datetime, required: false, note: "空でなければ使用済み。1 回だけ使える（BR50.3）" }
      - { name: invalidatedAt, type: datetime, required: false, note: "同じアカウントに新しいリンクが発行されたとき、前の未使用のものに付ける（BR50.3）" }
    constraints:
      - "有効 = usedAt も invalidatedAt も空で、expiresAt が現在より後"
      - "同じアカウントで、有効な PasswordResetToken は同時に 1 本まで（BR50.3）"

  - name: Invitation
    component: Household
    description: 家族グループへの招待リンク 1 本分。1 回だけ使える。リンクの元の値は保存せず、変換値だけを持つ。
    attributes:
      - { name: invitationId, type: id, required: true, unique: true }
      - { name: householdId, type: id, required: true, references: Household.householdId, note: "参加先はこの値で決まる。画面からは受け取らない（BR50.14）" }
      - { name: tokenDigest, type: text, required: true, unique: true, constraints: "推測できないランダムな値（十分に長い）の変換値。元の値は保存しない（BR50.10）。上流 components.md の token にあたる" }
      - { name: issuedBy, type: id, required: true, references: Member.memberId, note: "発行したメンバー。ID だけの参照（ADR-009）" }
      - { name: issuedAt, type: datetime, required: true }
      - { name: expiresAt, type: datetime, required: true, constraints: "issuedAt の 7 日後（BR50.9）" }
      - { name: usedAt, type: datetime, required: false, note: "空でなければ使用済み（BR50.12）" }
      - { name: usedBy, type: id, required: false, references: Member.memberId, note: "参加して作られた Member" }
    constraints:
      - "有効 = usedAt が空で、expiresAt が現在より後"
      - "同じ householdId で、有効な Invitation は同時に 10 本まで（BR50.9）"
      - "同時に 2 人が同じ Invitation で参加しても、成り立つのは 1 人だけ（usedAt を最終的に守る。BR50.12）"

  - name: DomainEventRecord
    component: Household
    description: 出した「出来事」の記録（C3）。確定した処理と同じ処理で記録し、そのあと配る。配れなかったものは、あとで配り直す。
    attributes:
      - { name: eventId, type: id, required: true, unique: true, note: "受け手が二度受けても結果が同じになるための目印（BR50.23）" }
      - { name: name, type: enum, required: true, allowed: [account.deleted, household.member-left, household.deleted] }
      - { name: householdId, type: id, required: false, references: Household.householdId, note: "household.* のとき必須（ADR-005、ADR-007）" }
      - { name: memberId, type: id, required: false, note: "household.member-left のとき必須" }
      - { name: accountId, type: id, required: false, note: "account.deleted のとき必須" }
      - { name: occurredAt, type: datetime, required: true }
      - { name: deliveredAt, type: datetime, required: false, note: "全員に配り終えた時刻。空のものが、配り直しの対象（BR50.23）" }
    constraints:
      - "個人情報（メールアドレス、表示名）は、出来事の中身に入れない。ID だけを持つ（BR50.23）"

  - name: DevMailOutbox
    component: Account
    description: 通し版だけで使う「開発用の送信箱」。MailSenderPort の通し版の代替が、送るはずだった内容を記録する（Q1 A）。本物のメール送信を入れたら使わない。
    attributes:
      - { name: outboxId, type: id, required: true, unique: true }
      - { name: accountId, type: id, required: true, references: Account.accountId }
      - { name: subject, type: text, required: true }
      - { name: body, type: text, required: true, note: "再設定リンクを含む。通し版の確認のためだけに保存する（BR50.25）" }
      - { name: createdAt, type: datetime, required: true }
      - { name: expiresAt, type: datetime, required: true, note: "対応する PasswordResetToken と同じ。過ぎたら見えなくし、消す" }
    constraints:
      - "見られるのは、通し版・開発の設定が有効なときだけ。本番の設定では、この画面も記録も無効（BR50.25）"
```

## 使わない・作らないもの

- **招待の再表示**：リンクの元の値は保存しないので、発行直後の 1 回しか表示できない。なくしたら、新しく発行する（BR50.10）。
- **グループ削除の連鎖の内容**：料理、好き嫌い、作った記録、候補の提案、献立、買い物リスト、画像のデータを消す処理は、それぞれの持ち主ユニットの受け口が行う。U7 は household.deleted を出し、自分の持つ Household、Member、Invitation を消すだけ（BR50.22）。

## 上流の名前との対応表

| 上流（components.md） | この設計 | 備考 |
|---|---|---|
| Account.failedLoginCount、lockedUntil | 同じ名前 | U1 の対応表で予告された属性。U7 で足す |
| Invitation.token | Invitation.tokenDigest | 元の値は保存せず、変換値だけを持つ（NFR3） |
| Invitation.usedAt | 同じ | 1 回だけ使える（Q4 A） |
| （なし） | PasswordResetToken | 再設定のリンク。上流にはないが、C1 の `/auth/password-reset/confirm` に必要 |
| （なし） | DomainEventRecord | C3 の「データベースに記録してから配る」ための記録 |
| （なし） | DevMailOutbox | 通し版だけ。C5 の代替 |

## 概要

| エンティティ | 持ち主コンポーネント | 一言で |
|---|---|---|
| Account（足す） | Account | 失敗の回数、ロックの期限、削除の印 |
| Member（使い方を足す） | Household | 退会で leftAt と名前の消去 |
| PasswordResetToken | Account | 再設定のリンク（60 分、1 回） |
| Invitation | Household | 招待リンク（7 日、1 回） |
| DomainEventRecord | Household | 出した出来事の記録と、配り直しの目印 |
| DevMailOutbox | Account | 通し版だけの「開発用の送信箱」 |
