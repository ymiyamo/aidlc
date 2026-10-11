-- U7 グループとアカウントの管理（account-admin）：追加だけの移行（001 は変更しない）
-- 一意性・期限・使用済みは、同時に来ても守れるよう DB の制約で最後の守りを置く（BR50.x）。

-- ---------- Account：ログイン失敗の制限、削除（BR50.5〜BR50.8、BR50.19、BR50.20） ----------
alter table accounts
  add column failed_login_count integer not null default 0 check (failed_login_count >= 0),
  add column locked_until timestamptz,
  add column delete_fail_count integer not null default 0 check (delete_fail_count >= 0),
  add column delete_locked_until timestamptz,
  add column deleted_at timestamptz;
-- アカウント削除でメールアドレスとパスワードの変換値を空にするため、NOT NULL を外す（行は残す。ADR-009）
alter table accounts alter column email drop not null;
alter table accounts alter column password_digest drop not null;
-- 削除済みなら、メールアドレスもパスワードの変換値も空であること
alter table accounts add constraint accounts_deleted_cleared_chk
  check (deleted_at is null or (email is null and password_digest is null and display_name is null));

-- ---------- Household：削除済みの印（BR50.22。暫定） ----------
-- 他のユニットの表（料理など）が households を参照しているため、行は残して印だけ付ける。
-- 各ユニットが household.deleted を受けて自分のデータを消したあと、物理削除する想定
alter table households add column deleted_at timestamptz;

-- ---------- Invitation：招待リンク（BR50.9〜BR50.15） ----------
-- token_digest にはリンクの値の変換値（SHA-256）だけを保存する。元の値は保存しない（BR50.10）
create table invitations (
  invitation_id uuid primary key,
  household_id  uuid not null references households (household_id),
  token_digest  text not null,
  issued_by     uuid not null references members (member_id),
  issued_at     timestamptz not null,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_by       uuid,
  check (expires_at > issued_at),
  -- 使用済みなら使った人が必ずいる（片方だけは作れない）
  check ((used_at is null) = (used_by is null))
);
create unique index invitations_token_uq on invitations (token_digest);
create index invitations_household_idx on invitations (household_id);

-- ---------- PasswordResetToken：パスワード再設定のリンク（BR50.1〜BR50.4） ----------
create table password_resets (
  reset_id       uuid primary key,
  account_id     uuid not null references accounts (account_id) on delete cascade,
  token_digest   text not null,
  issued_at      timestamptz not null,
  expires_at     timestamptz not null,
  used_at        timestamptz,
  invalidated_at timestamptz,
  check (expires_at > issued_at)
);
create unique index password_resets_token_uq on password_resets (token_digest);
create index password_resets_account_idx on password_resets (account_id, issued_at);

-- ---------- DevMailOutbox：開発用の送信箱（BR50.25。通し版・開発の設定のときだけ使う） ----------
create table dev_mail_outbox (
  outbox_id  uuid primary key,
  account_id uuid not null references accounts (account_id) on delete cascade,
  to_address text not null,
  subject    text not null,
  body       text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null
);
create index dev_mail_outbox_to_idx on dev_mail_outbox (lower(to_address), created_at desc);

-- ---------- DomainEventRecord：出来事の記録（BR50.23）。ID だけを持つ ----------
create table domain_events (
  event_id     uuid primary key,
  name         text not null check (name in ('household.member-left', 'household.deleted', 'account.deleted')),
  payload      jsonb not null,
  occurred_at  timestamptz not null,
  delivered_at timestamptz
);
create index domain_events_pending_idx on domain_events (occurred_at) where delivered_at is null;
