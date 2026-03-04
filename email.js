'use strict';

let resend = null;
const FROM_EMAIL = process.env.FROM_EMAIL || 'hello@thefairmap.com';

try {
  if (process.env.RESEND_API_KEY) {
    const { Resend } = require('resend');
    resend = new Resend(process.env.RESEND_API_KEY);
    console.log('📧 Resend email configured');
  }
} catch (e) {
  console.warn('⚠️  Resend not available');
}

async function send(to, subject, html) {
  if (!resend) {
    console.log(`📧 [mock] To: ${to} | Subject: ${subject}`);
    return;
  }
  try {
    await resend.emails.send({ from: FROM_EMAIL, to, subject, html });
  } catch (e) {
    console.error('Email send error:', e.message);
  }
}

function sendVendorWelcome(email, name, tenantName) {
  return send(email, `Welcome to ${tenantName}!`, `
    <h2>Welcome, ${name}!</h2>
    <p>Your vendor account on <strong>${tenantName}</strong> has been created.</p>
    <p>You can now log in to manage your listing, update your business info, and more.</p>
    <p>— TheFairMap</p>
  `);
}

function sendSignupNotification(organization, email, slug) {
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL || 'chris@beekings.com';
  return send(adminEmail, `New map signup: ${organization}`, `
    <h2>New Map Signup Request</h2>
    <p><strong>Organization:</strong> ${organization}</p>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Requested slug:</strong> ${slug}</p>
    <p>Review at <a href="https://thefairmap.com/platform">Platform Admin</a></p>
  `);
}

function sendApprovalNotification(email, name, tenantName, slug) {
  const BASE_URL = process.env.BASE_URL || 'https://thefairmap.com';
  return send(email, `Your listing edit was approved — ${tenantName}`, `
    <h2>Edit Approved!</h2>
    <p>Hi ${name}, your submitted changes on <strong>${tenantName}</strong> have been approved and are now live.</p>
    <p><a href="${BASE_URL}">View your listing</a></p>
  `);
}

module.exports = { send, sendVendorWelcome, sendSignupNotification, sendApprovalNotification };
