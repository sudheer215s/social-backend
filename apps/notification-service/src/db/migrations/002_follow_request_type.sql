ALTER TABLE notification.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notification.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('follow','follow_request','like','reply','mention','repost'));
