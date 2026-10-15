# KYVO — Legal Review Checklist (Australia)

> Draft for legal review. Not legal advice. Items below must be reviewed by a qualified Australian lawyer (and, where noted, an accountant) before launch.

Draft documents to review: `legal/privacy.html`, `legal/terms.html`, `legal/subscription.html`, `legal/disclaimer.html`, `legal/contact.html`, and `content/tiktok-content-ideas.md`.

## 0. Placeholders to complete
- [ ] Operator legal name and ABN (`[Business name, ABN]`), postal address, governing State/Territory.
- [ ] Real support/privacy email (replace placeholder `support@kyvo.example`).
- [ ] "Last updated" dates, response timeframes, deletion/backup timeframes, retention periods.
- [ ] Settings paths in the app match the actual UI.

## 1. Privacy Act 1988 (Cth) and the Australian Privacy Principles
- [ ] Confirm whether the Privacy Act applies (small business exemption does not apply to businesses providing a health service / holding health information — confirm KYVO's position and treat as covered regardless).
- [ ] Health information (weight, measurements, photos, food/workout logs, allergies, sex) is sensitive information: confirm consent wording, timing (before collection) and UX (APP 3).
- [ ] APP 5 collection notice: is the in-app notice at sign-up/onboarding sufficient and linked to the policy?
- [ ] APP 1 privacy policy content complete (kinds of info, purposes, access/correction, complaints, overseas disclosure and likely countries).
- [ ] APP 6 use/disclosure limited to primary purpose; confirm analytics use is a related secondary purpose or consented.
- [ ] APP 7 direct marketing — opt-in/opt-out handling; sensitive info never used for marketing without consent.
- [ ] APP 8 overseas disclosure: Stripe, Supabase (region to be chosen), hosting and email providers — list countries; decide between "reasonable steps" contractual approach vs consent; review provider DPAs.
- [ ] APP 11 security and destruction/de-identification; backup deletion timelines; encryption at rest.
- [ ] APP 12/13 access and correction processes, including in-app export format.
- [ ] Notifiable Data Breaches scheme — incident response plan.
- [ ] Progress photos: private storage, access controls, deletion on account deletion.
- [ ] Track any Privacy Act reform changes (e.g. statutory tort, children's online privacy code, "fair and reasonable" test) and update accordingly.
- [ ] State health records laws (e.g. Health Records Act 2001 (Vic), Health Records and Information Privacy Act 2002 (NSW)) — confirm applicability.

## 2. Cookies, analytics and TikTok Pixel
- [ ] Consent banner wording; Pixel loads only after opt-in; easy withdrawal.
- [ ] Confirm no health/body/food/workout data (including via URL paths, page titles or event names) is passed to the Pixel.
- [ ] Review TikTok's business terms and data processing terms.
- [ ] UTM attribution storage disclosed in privacy policy.

## 3. Spam Act 2003 (Cth)
- [ ] Classify each email type (transactional/service vs commercial electronic message).
- [ ] Consent for marketing emails (express or inferred), sender identification, functional unsubscribe honoured within 5 business days.
- [ ] Renewal reminders and failed-payment emails — confirm they remain non-commercial if they include any promotional content.

## 4. Australian Consumer Law (ACL)
- [ ] Consumer guarantee wording (mandatory text for services) in Terms and Subscription Terms.
- [ ] No statements that could mislead about refund rights ("no refunds" must be qualified).
- [ ] Auto-renewal disclosure: clear and prominent before purchase (price, frequency, renewal, how to cancel).
- [ ] Renewal reminder approach for annual plans; consider monthly reminders.
- [ ] Price change notice period and process.
- [ ] Failed payment / grace period behaviour described accurately.
- [ ] Liability limitation clause (s 64A ACL) correctly framed.
- [ ] Unfair contract terms regime (penalties apply since November 2023): review unilateral variation, suspension/termination, liability, and feature change clauses in standard-form consumer contracts.
- [ ] Marketing claims (website, landing pages, TikTok content) — not misleading or deceptive (ss 18, 29).
- [ ] Any future "free trial" — disclosure and reminder before conversion.

## 5. ACCC guidance on subscription traps and dark patterns
- [ ] Cancellation is as easy as sign-up (online, few steps, no forced contact).
- [ ] No pre-ticked boxes, hidden renewal terms, drip pricing or confusing cancellation flows.
- [ ] Check against ACCC guidance and any proposed unfair trading practices prohibition (subscription traps) — update if legislated.

## 6. GST and tax (accountant)
- [ ] Confirm whether the business is or must be registered for GST (A$75,000 turnover threshold).
- [ ] If not registered, remove "incl. GST" wording; if registered, issue compliant tax invoices via Stripe.
- [ ] Record retention period for billing/tax records (generally 5 years under tax law — confirm) and reflect in Privacy Policy.
- [ ] Stripe Tax configuration if applicable.

## 7. TGA and health claims
- [ ] Confirm KYVO is not "software as a medical device" (no diagnosis/treatment of conditions) under the Therapeutic Goods Act 1989 and the TGA software exemptions.
- [ ] Review marketing for therapeutic claims (e.g. treating/preventing disease, weight-loss claims tied to products) and Therapeutic Goods Advertising Code if any supplements or therapeutic goods are ever mentioned or promoted.
- [ ] Review meal content and nutrition claims against the Food Standards Code (Standard 1.2.7) where relevant to marketing.

## 8. Fitness and nutrition disclaimer
- [ ] Adequacy of warnings (pregnancy, medical conditions, eating disorder history, under 18, stop if pain).
- [ ] Consider requiring an acknowledgement checkbox at onboarding.
- [ ] Butterfly Foundation helpline details correct.
- [ ] Consider safety guardrails in calorie targets (minimum floors) — product and legal input.

## 9. Age restriction
- [ ] Minimum age 18: age gate wording and handling of accounts found to belong to minors.

## 10. Marketing and influencer content
- [ ] Ad disclosure for paid partnerships (TikTok branded content toggle; AANA Code of Ethics and AANA guidance on influencer marketing; ACCC influencer guidance).
- [ ] No before/after or results claims, no fake testimonials, no unverifiable statistics.
- [ ] Music and asset licensing for TikTok content.

## 11. App store terms (if wrapped as a native app later)
- [ ] Apple App Store / Google Play rules on in-app purchases vs external payment (Stripe) and anti-steering rules.
- [ ] Health data rules (Apple HealthKit / Google Health Connect) and app privacy labels / Data safety form.
- [ ] Account deletion requirement in-app (already planned).

## 12. Trademark, business name and domain
- [ ] IP Australia trade mark search for "KYVO" and the slogan "TRAIN SMARTER. GET STRONGER." in relevant classes (e.g. 9, 41, 44).
- [ ] Check for conflicts with existing fitness/health brands, including overseas if expanding.
- [ ] ASIC business name registration and ABN details.
- [ ] Domain availability (.com.au eligibility requires an Australian presence/ABN) and social handles.

## 13. Vendor contracts
- [ ] Stripe, Supabase, hosting, email provider: terms, DPAs, data location, sub-processors.
- [ ] Choose Supabase region (consider Sydney for data residency).
