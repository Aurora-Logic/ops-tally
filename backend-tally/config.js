// Central config for Tally integration.
// All tuneable values come from environment variables so nothing is hardcoded.
module.exports = {
  // Which Tally company to target. Empty string = use whichever is currently active in Tally.
  // Set TALLY_COMPANY="My Company Name" to enforce a specific company — prevents accidental
  // syncs landing in the wrong company when the accountant switches context.
  tallyCompany: process.env.TALLY_COMPANY || '',

  // Shared secret the TDL file sends in every webhook POST body.
  // Set TALLY_WEBHOOK_SECRET on the VPS and mirror the same value in ops-sync.tdl.
  // Leave empty to disable auth (not recommended for production).
  webhookSecret: process.env.TALLY_WEBHOOK_SECRET || '',

  // Optional URL to POST an alert payload when a Tally job permanently fails.
  // Accepts any HTTP endpoint: Slack incoming webhook, Discord, custom alerting service.
  alertWebhookUrl: process.env.TALLY_ALERT_WEBHOOK_URL || '',
};
