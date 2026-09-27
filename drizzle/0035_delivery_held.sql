-- A delivery that has nowhere to go yet (Telegram not linked, no bot) is held,
-- not failed: the alert was detected, and linking Telegram releases it.
ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'held';
