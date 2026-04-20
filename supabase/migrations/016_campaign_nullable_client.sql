-- Allow campaigns to be saved as drafts without a client selected
ALTER TABLE campaigns ALTER COLUMN client_id DROP NOT NULL;
