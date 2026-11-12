document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => {
  const language = button.dataset.language;
  document.querySelectorAll('[data-language]').forEach(item => item.classList.toggle('active', item === button));
  document.querySelectorAll('[data-policy-language]').forEach(section => section.classList.toggle('hidden', section.dataset.policyLanguage !== language));
  document.documentElement.lang = language === 'or' ? 'or' : 'en';
}));

fetch('/api/v1/public/business-info').then(response => response.json()).then(info => {
  document.querySelector('#business-name').textContent = info.legalName;
  document.querySelector('#business-address').textContent = info.address;
  document.querySelector('#grievance-officer').textContent = info.grievanceOfficer;
  const email = document.querySelector('#grievance-email'); email.textContent = info.grievanceEmail; if (info.grievanceEmail) email.href = 'mailto:' + info.grievanceEmail; else email.hidden = true;
  const phone = document.querySelector('#grievance-phone'); phone.textContent = info.grievancePhone; if (info.grievancePhone) phone.href = 'tel:' + info.grievancePhone; else phone.hidden = true;
  if (!info.legalReviewApproved) { const notice = document.querySelector('#policy-review-status'); notice.textContent = 'This policy set must be reviewed by the business and its legal/tax advisers before public paid bookings are enabled.'; notice.classList.remove('hidden'); }
}).catch(() => { document.querySelector('#business-name').textContent = 'Business details are temporarily unavailable.'; });
