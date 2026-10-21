import mongoose from '../infrastructure/Mongoose.mjs'

const { Schema } = mongoose

// Unlike one-time tokens, invitations are retained after expiry so administrators
// can distinguish expired invitations from accounts with unknown provenance.
const SiteInvitationSchema = new Schema(
  {
    email: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdAt: { type: Date, required: true },
    lastSentAt: Date,
    expiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'revoked'],
      required: true,
    },
    generation: { type: String, required: true },
    acceptedAt: Date,
    revokedAt: Date,
    deliveryStatus: {
      type: String,
      enum: ['not_sent', 'sent', 'failed'],
      required: true,
    },
    deliveryError: String,
  },
  { collection: 'siteInvitations' }
)

export const SiteInvitation = mongoose.model(
  'SiteInvitation',
  SiteInvitationSchema
)
