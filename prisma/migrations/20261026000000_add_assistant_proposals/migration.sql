CREATE TYPE "AssistantProposalStatus" AS ENUM ('PENDING', 'APPLIED', 'CANCELLED');

CREATE TABLE "AssistantProposal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AssistantProposalStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "timeZone" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssistantProposal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssistantProposal_window_check" CHECK ("windowEnd" > "windowStart"),
    CONSTRAINT "AssistantProposal_expiry_check" CHECK ("expiresAt" > "createdAt"),
    CONSTRAINT "AssistantProposal_applied_check" CHECK (("status" = 'APPLIED') = ("appliedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "AssistantProposal_id_userId_key" ON "AssistantProposal"("id", "userId");
CREATE INDEX "AssistantProposal_userId_status_expiresAt_idx" ON "AssistantProposal"("userId", "status", "expiresAt");
ALTER TABLE "AssistantProposal" ADD CONSTRAINT "AssistantProposal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The confirmation endpoint accepts only the proposal id and a decision.
-- Preserve that exact reviewed plan even if a later code path tries to edit it.
CREATE OR REPLACE FUNCTION "protect_assistant_proposal"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."message" IS DISTINCT FROM OLD."message"
    OR NEW."changes" IS DISTINCT FROM OLD."changes"
    OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot"
    OR NEW."timeZone" IS DISTINCT FROM OLD."timeZone"
    OR NEW."windowStart" IS DISTINCT FROM OLD."windowStart"
    OR NEW."windowEnd" IS DISTINCT FROM OLD."windowEnd"
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Assistant proposal payload is immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> 'PENDING' AND (
    NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."appliedAt" IS DISTINCT FROM OLD."appliedAt"
  ) THEN
    RAISE EXCEPTION 'Assistant proposal is already resolved' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "assistant_proposal_immutable"
  BEFORE UPDATE ON "AssistantProposal"
  FOR EACH ROW EXECUTE FUNCTION "protect_assistant_proposal"();
