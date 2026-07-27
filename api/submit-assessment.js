// api/submit-assessment.js
// Vercel serverless function — receives assessment answers + computed matches
// from the site's wizard and sends TWO emails via Resend:
//   1. An internal notification to sales@endpointprotection.net (full detail)
//   2. A visitor-facing copy of their matches, sent to the email they typed in
//      (this is what the site's copy promises: "we'll send your matches to
//      your inbox")
//
// Requires an environment variable set in the Vercel project:
//   RESEND_API_KEY = <your Resend API key>
//
// Requires endpointprotection.net to be a VERIFIED sending domain in Resend
// (Domains -> Add Domain in the Resend dashboard, then add the DNS records
// it gives you at GoDaddy — merge the SPF entry with the existing Microsoft
// 365 one rather than adding a second v=spf1 record). Until the domain is
// verified, Resend will only deliver to the email address you signed up with.

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendEmail(payload) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detail = await res.text();
    return { ok: false, detail };
  }
  return { ok: true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { answers = {}, matches = [], requestedContact = [] } = req.body || {};

    const matchLines = matches.length
      ? matches.map((m, i) => `${i + 1}. ${m.name} (score ${m.score}/100) — ${m.specialty}`)
      : ['No strong match returned.'];

    const contactLine = requestedContact.length
      ? `Requested contact from: ${requestedContact.join(', ')}`
      : `Requested contact from: none selected`;

    // --- Internal notification (full detail, to sales@) ---
    const internalText = [
      `New assessment submission — endpointprotection.net`,
      ``,
      `Company size: ${answers.companySize || '-'}`,
      `Device count: ${answers.endpointCount || '-'}`,
      `Device mix: ${(answers.deviceMix || []).join(', ') || '-'}`,
      `Remote workforce: ${answers.remoteWorkforce || '-'}`,
      `Current protection: ${answers.currentProtection || '-'}`,
      `Security ownership: ${answers.inHouseCapacity || '-'}`,
      `Compliance requirement: ${answers.complianceRequirement || '-'}`,
      `Primary concern: ${answers.primaryConcern || '-'}`,
      `Visitor email: ${answers.email || '-'}`,
      ``,
      `Computed matches:`,
      ...matchLines,
      ``,
      contactLine,
    ].join('\n');

    const internalResult = await sendEmail({
      from: 'Endpoint Protection Advisors <assessments@endpointprotection.net>',
      to: ['sales@endpointprotection.net'],
      reply_to: answers.email || undefined,
      subject: `Endpoint Protection Assessment — ${answers.companySize || 'New'} lead`,
      text: internalText,
    });

    if (!internalResult.ok) {
      console.error('Resend API error (internal notification):', internalResult.detail);
      return res.status(502).json({ error: 'Internal notification failed', detail: internalResult.detail });
    }

    // --- Visitor-facing copy (only if they gave a plausible email) ---
    let visitorSent = false;
    if (isValidEmail(answers.email)) {
      const visitorText = [
        `Thanks for completing the Endpoint Protection Advisors assessment.`,
        ``,
        `Based on what you told us, here's how your options ranked:`,
        ``,
        ...matchLines,
        ``,
        requestedContact.length
          ? `You asked to be contacted by: ${requestedContact.join(', ')}. We'll pass your details along.`
          : `You didn't request contact from anyone — this is just for your own reference.`,
        ``,
        `We'll follow up directly if there's anything worth discussing further.`,
        `Final pricing and terms are always confirmed with the provider directly — this isn't a purchase or commitment.`,
        ``,
        `— Endpoint Protection Advisors`,
      ].join('\n');

      const visitorResult = await sendEmail({
        from: 'Endpoint Protection Advisors <assessments@endpointprotection.net>',
        to: [answers.email],
        reply_to: 'sales@endpointprotection.net',
        subject: `Your endpoint protection matches`,
        text: visitorText,
      });

      visitorSent = visitorResult.ok;
      if (!visitorResult.ok) {
        // Don't fail the whole request over this — the business-critical
        // internal notification already succeeded. Just log it.
        console.error('Resend API error (visitor copy):', visitorResult.detail);
      }
    }

    return res.status(200).json({ success: true, visitorEmailSent: visitorSent });
  } catch (err) {
    console.error('submit-assessment error:', err);
    return res.status(500).json({ error: err.message });
  }
}
