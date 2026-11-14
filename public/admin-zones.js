let adminZoneMap = null;
let adminZoneMarker = null;
let adminZoneCircle = null;
let adminZoneEditingId = null;
let adminZoneMapPromise = null;

const QWH_ODIA = {
  'ACCOUNT': 'ଖାତା', 'YOUR ACCOUNT': 'ଆପଣଙ୍କ ଖାତା', 'Install app': 'ଆପ୍ ଇନଷ୍ଟଲ୍ କରନ୍ତୁ', 'Sign out': 'ସାଇନ୍ ଆଉଟ୍',
  'WORKER SPACE': 'କର୍ମୀ କାର୍ଯ୍ୟକ୍ଷେତ୍ର', 'Job requests': 'କାମ ଅନୁରୋଧ', 'My jobs': 'ମୋ କାମ', 'Earnings': 'ଆୟ', 'WORKER': 'କର୍ମୀ', 'Available jobs': 'ଉପଲବ୍ଧ କାମ', 'My assigned jobs': 'ମୋତେ ଦିଆଯାଇଥିବା କାମ', 'See work and update each wash from here.': 'ଏଠାରେ କାମ ଦେଖନ୍ତୁ ଏବଂ ପ୍ରତ୍ୟେକ ଧୋଇବାର ସ୍ଥିତି ବଦଳାନ୍ତୁ।', 'Wallet ledger balances after completed service.': 'ସେବା ସମ୍ପୂର୍ଣ୍ଣ ହେବା ପରେ ଆୟ ହିସାବ ଦେଖନ୍ତୁ।', 'Wallet': 'ୱାଲେଟ୍', 'Loading jobs…': 'କାମ ଲୋଡ୍ ହେଉଛି…', 'Loading your earnings…': 'ଆପଣଙ୍କ ଆୟ ଲୋଡ୍ ହେଉଛି…', 'You are online': 'ଆପଣ ଅନଲାଇନ୍ ଅଛନ୍ତି', 'You are offline': 'ଆପଣ ଅଫଲାଇନ୍ ଅଛନ୍ତି', 'No assigned jobs yet': 'ଏପର୍ଯ୍ୟନ୍ତ କାମ ଦିଆଯାଇନାହିଁ', 'No available jobs right now': 'ଏବେ କୌଣସି କାମ ଉପଲବ୍ଧ ନାହିଁ', 'When an admin assigns you a wash, it will appear here.': 'ପ୍ରଶାସକ ଆପଣଙ୍କୁ କାମ ଦେଲେ ଏଠାରେ ଦେଖାଯିବ।', 'Update my location': 'ମୋ ସ୍ଥାନ ଅପଡେଟ୍ କରନ୍ତୁ', 'Toggle online status': 'ଅନଲାଇନ୍ ସ୍ଥିତି ବଦଳାନ୍ତୁ',
  'Overview': 'ସାରାଂଶ', 'Bookings': 'ବୁକିଂଗୁଡ଼ିକ', 'Book a wash': 'ଧୋଇବା ବୁକ୍ କରନ୍ତୁ', 'Vehicles': 'ଯାନବାହନ', 'Addresses': 'ଠିକଣା', 'Offers & alerts': 'ଅଫର୍ ଓ ସୂଚନା', 'Support': 'ସହାୟତା', 'Support desk': 'ସହାୟତା କେନ୍ଦ୍ର',
  'Help and support': 'ସହାୟତା', 'Send a booking question and keep its reference number.': 'ବୁକିଂ ବିଷୟରେ ପ୍ରଶ୍ନ ପଠାନ୍ତୁ ଏବଂ ରେଫରେନ୍ସ ନମ୍ବର ସଂରକ୍ଷଣ କରନ୍ତୁ।', 'Contact QuickWashHub': 'QuickWashHub ସହିତ ଯୋଗାଯୋଗ କରନ୍ତୁ', 'Booking (optional)': 'ବୁକିଂ (ଇଚ୍ଛାଧୀନ)', 'General question': 'ସାଧାରଣ ପ୍ରଶ୍ନ', 'Subject': 'ବିଷୟ', 'How can we help?': 'ଆମେ କିପରି ସାହାଯ୍ୟ କରିପାରିବୁ?', 'Send support request': 'ସହାୟତା ଅନୁରୋଧ ପଠାନ୍ତୁ', 'Your support requests': 'ଆପଣଙ୍କ ସହାୟତା ଅନୁରୋଧ', 'Loading requests…': 'ଅନୁରୋଧ ଲୋଡ୍ ହେଉଛି…', 'Account data': 'ଖାତା ତଥ୍ୟ', 'You can request account deletion. We will review any records that must be kept for payment or legal obligations.': 'ଆପଣ ଖାତା ଡିଲିଟ୍ କରିବାକୁ ଅନୁରୋଧ କରିପାରିବେ। ଦେୟ କିମ୍ବା ଆଇନଗତ କାରଣରୁ ରଖିବାକୁ ପଡ଼ୁଥିବା ରେକର୍ଡ ଆମେ ଯାଞ୍ଚ କରିବୁ।', 'Request account deletion': 'ଖାତା ଡିଲିଟ୍ କରିବାକୁ ଅନୁରୋଧ କରନ୍ତୁ', 'No support requests yet.': 'ଏପର୍ଯ୍ୟନ୍ତ କୌଣସି ସହାୟତା ଅନୁରୋଧ ନାହିଁ।',
  'Hello, ': 'ନମସ୍କାର, ', 'Book a convenient car, bike, or solar-panel wash.': 'କାର୍, ବାଇକ୍ କିମ୍ବା ସୋଲାର୍ ପ୍ୟାନେଲ୍ ଧୋଇବା ସହଜରେ ବୁକ୍ କରନ୍ତୁ।', 'Your next booking': 'ଆପଣଙ୍କ ପରବର୍ତ୍ତୀ ବୁକିଂ', 'No booking yet': 'ଏପର୍ଯ୍ୟନ୍ତ ବୁକିଂ ନାହିଁ', 'Choose a service and book in a few steps.': 'ସେବା ବାଛନ୍ତୁ ଏବଂ କିଛି ପଦକ୍ଷେପରେ ବୁକ୍ କରନ୍ତୁ।', 'My vehicles': 'ମୋ ଯାନବାହନ', 'My addresses': 'ମୋ ଠିକଣା', 'Get help': 'ସହାୟତା ପାଆନ୍ତୁ', 'Recent bookings': 'ସାମ୍ପ୍ରତିକ ବୁକିଂ', 'Services in your area': 'ଆପଣଙ୍କ ଅଞ୍ଚଳର ସେବା', 'Services are being set up for your zone.': 'ଆପଣଙ୍କ ଜୋନ୍ ପାଇଁ ସେବା ପ୍ରସ୍ତୁତ ହେଉଛି।', 'Residential or commercial · quote after site inspection': 'ଘରୋଇ କିମ୍ବା ବାଣିଜ୍ୟିକ · ସ୍ଥାନ ଯାଞ୍ଚ ପରେ ମୂଲ୍ୟ ଜଣାଯିବ', 'Request quote': 'ମୂଲ୍ୟ ଅନୁରୋଧ କରନ୍ତୁ', 'Coming later': 'ପରେ ଆସିବ', 'Not available yet': 'ଏବେ ଉପଲବ୍ଧ ନାହିଁ',
  'Your vehicles': 'ଆପଣଙ୍କ ଯାନବାହନ', 'Only vehicles you add to your account appear here.': 'ଆପଣ ଖାତାରେ ଯୋଡ଼ିଥିବା ଯାନବାହନ ଏଠାରେ ଦେଖାଯିବ।', 'Add a vehicle': 'ଯାନବାହନ ଯୋଡ଼ନ୍ତୁ', 'Type': 'ପ୍ରକାର', 'Make and model': 'କମ୍ପାନୀ ଓ ମଡେଲ୍', 'Registration number': 'ରେଜିଷ୍ଟ୍ରେସନ୍ ନମ୍ବର', 'Add vehicle': 'ଯାନବାହନ ଯୋଡ଼ନ୍ତୁ', 'Saved vehicles': 'ସଂରକ୍ଷିତ ଯାନବାହନ', 'Remove': 'ହଟାନ୍ତୁ',
  'Service addresses': 'ସେବା ଠିକଣା', 'Pin your location and add the nearby directions a wash partner needs.': 'ସ୍ଥାନ ପିନ୍ କରନ୍ତୁ ଏବଂ ସେବାକର୍ମୀଙ୍କ ପାଇଁ ନିକଟସ୍ଥ ଚିହ୍ନ ଲେଖନ୍ତୁ।', 'Add a service address': 'ସେବା ଠିକଣା ଯୋଡ଼ନ୍ତୁ', '◎ Use my current location': '◎ ମୋ ବର୍ତ୍ତମାନର ସ୍ଥାନ ବ୍ୟବହାର କରନ୍ତୁ', 'Your street address fills from the pin. Add nearby directions below.': 'ପିନ୍‌ରୁ ଠିକଣା ଭରାଯିବ। ତଳେ ନିକଟସ୍ଥ ଚିହ୍ନ ଯୋଡ଼ନ୍ତୁ।', 'Drag the pin or tap the map to adjust the pickup location.': 'ପିନ୍ ଟାଣନ୍ତୁ କିମ୍ବା ମାନଚିତ୍ରକୁ ଟ୍ୟାପ୍ କରି ସ୍ଥାନ ବଦଳାନ୍ତୁ।', 'Save as': 'ଏହି ନାମରେ ସଂରକ୍ଷଣ କରନ୍ତୁ', 'Detected address': 'ଚିହ୍ନଟ ଠିକଣା', 'Nearby landmark or exact directions': 'ନିକଟସ୍ଥ ଚିହ୍ନ କିମ୍ବା ସଠିକ୍ ନିର୍ଦ୍ଦେଶ', 'Check service area and save →': 'ସେବା ଅଞ୍ଚଳ ଯାଞ୍ଚ କରି ସଂରକ୍ଷଣ କରନ୍ତୁ →', 'Saved addresses': 'ସଂରକ୍ଷିତ ଠିକଣା',
  'Offers & alerts': 'ଅଫର୍ ଓ ସୂଚନା', 'Choose whether to receive offers by email and WhatsApp. Push also needs your browser permission.': 'ଇମେଲ୍ ଓ WhatsApp ରେ ଅଫର୍ ପାଇବେ କି ନାହିଁ ବାଛନ୍ତୁ। ପୁଶ୍ ସୂଚନା ପାଇଁ ବ୍ରାଉଜର୍ ଅନୁମତି ଦରକାର।', 'Marketing preferences': 'ଅଫର୍ ପସନ୍ଦ', 'Send me QuickWashHub offers by email and WhatsApp. I can unsubscribe any time.': 'ମୋତେ ଇମେଲ୍ ଓ WhatsApp ରେ QuickWashHub ଅଫର୍ ପଠାନ୍ତୁ। ମୁଁ ଯେକୌଣସି ସମୟରେ ବନ୍ଦ କରିପାରିବି।', 'Save preferences': 'ପସନ୍ଦ ସଂରକ୍ଷଣ କରନ୍ତୁ', 'Checking push support…': 'ପୁଶ୍ ସୂଚନା ଯାଞ୍ଚ ହେଉଛି…', 'Enable push notifications': 'ପୁଶ୍ ସୂଚନା ଚାଲୁ କରନ୍ତୁ', 'Turn off push here': 'ଏଠାରେ ପୁଶ୍ ବନ୍ଦ କରନ୍ତୁ', 'Your browser does not offer a direct install prompt. You can continue using QuickWashHub here.': 'ଏହି ବ୍ରାଉଜର୍‌ରେ ସିଧାସଳଖ ଇନଷ୍ଟଲ୍ ବିକଳ୍ପ ନାହିଁ। ଏଠାରୁ QuickWashHub ବ୍ୟବହାର ଜାରି ରଖନ୍ତୁ।',
  'Quick booking': 'ସହଜ ବୁକିଂ', 'We’ll only ask for details you haven’t saved yet.': 'ଆପଣ ସଂରକ୍ଷଣ କରିନଥିବା ତଥ୍ୟ ମାତ୍ର ପଚରାଯିବ।', '1. Your contact': '୧. ଆପଣଙ୍କ ଯୋଗାଯୋଗ', '2. What needs washing?': '୨. କଣ ଧୋଇବାକୁ ହେବ?', '3. Where should we come?': '୩. ଆମେ କେଉଁଠାକୁ ଆସିବୁ?', 'Name': 'ନାମ', 'Mobile number': 'ମୋବାଇଲ୍ ନମ୍ବର', '10-digit Indian mobile': '୧୦ ଅଙ୍କର ଭାରତୀୟ ମୋବାଇଲ୍', 'Service type': 'ସେବା ପ୍ରକାର', 'Car or bike wash': 'କାର୍ କିମ୍ବା ବାଇକ୍ ଧୋଇବା', 'Solar panel wash · request a quote': 'ସୋଲାର୍ ପ୍ୟାନେଲ୍ · ମୂଲ୍ୟ ଅନୁରୋଧ', 'Your vehicle': 'ଆପଣଙ୍କ ଯାନବାହନ', '+ Add a vehicle': '+ ଯାନବାହନ ଯୋଡ଼ନ୍ତୁ', 'Property type': 'ସମ୍ପତ୍ତି ପ୍ରକାର', 'Residential': 'ଘରୋଇ', 'Commercial': 'ବାଣିଜ୍ୟିକ', 'Approximate panel count': 'ପ୍ୟାନେଲ୍‌ର ଆନୁମାନିକ ସଂଖ୍ୟା', 'Roof type and access details': 'ଛାତର ପ୍ରକାର ଓ ପହଞ୍ଚିବା ବିବରଣୀ', 'Anything else about the installation?': 'ସ୍ଥାପନ ବିଷୟରେ ଅନ୍ୟ କିଛି?', 'Available service': 'ଉପଲବ୍ଧ ସେବା', 'Saved address': 'ସଂରକ୍ଷିତ ଠିକଣା', '+ Add a service address': '+ ସେବା ଠିକଣା ଯୋଡ଼ନ୍ତୁ', 'Nearby directions': 'ନିକଟସ୍ଥ ନିର୍ଦ୍ଦେଶ', 'When should we come?': 'ଆମେ କେବେ ଆସିବୁ?', 'Continue to payment': 'ଦେୟ ପାଇଁ ଆଗକୁ ବଢ଼ନ୍ତୁ', 'Send quote request': 'ମୂଲ୍ୟ ଅନୁରୋଧ ପଠାନ୍ତୁ',
  'Your next booking is lined up.': 'ଆପଣଙ୍କ ପରବର୍ତ୍ତୀ ବୁକିଂ ପ୍ରସ୍ତୁତ।', 'Pay': 'ଦେୟ କରନ୍ତୁ', 'Cancel': 'ବାତିଲ୍ କରନ୍ତୁ', 'Rate': 'ମୂଲ୍ୟାୟନ କରନ୍ତୁ', 'Finding a worker': 'ସେବାକର୍ମୀ ଖୋଜାଯାଉଛି', 'Assigned': 'ନିଯୁକ୍ତ ହୋଇଛି', 'Worker on the way': 'ସେବାକର୍ମୀ ଆସୁଛନ୍ତି', 'In progress': 'କାମ ଚାଲିଛି', 'Completed': 'ସମ୍ପନ୍ନ', 'Cancelled': 'ବାତିଲ୍', 'Ready to pay': 'ଦେୟ ପାଇଁ ପ୍ରସ୍ତୁତ', 'Quote in review': 'ମୂଲ୍ୟ ଯାଞ୍ଚ ହେଉଛି', 'Quote ready': 'ମୂଲ୍ୟ ପ୍ରସ୍ତୁତ'
};
const QWH_ENGLISH = Object.fromEntries(Object.entries(QWH_ODIA).map(([en, or]) => [or, en]));
let qwhLanguage = 'en';
function applyQwhLanguage(rootNode = document.body) {
  const map = qwhLanguage === 'or' ? QWH_ODIA : QWH_ENGLISH;
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const trimmed = node.nodeValue.trim();
    if (qwhLanguage === 'or' && trimmed.startsWith('Hello, ')) node.nodeValue = node.nodeValue.replace('Hello, ', 'ନମସ୍କାର, ');
    else if (qwhLanguage === 'en' && trimmed.startsWith('ନମସ୍କାର, ')) node.nodeValue = node.nodeValue.replace('ନମସ୍କାର, ', 'Hello, ');
    else if (map[trimmed]) node.nodeValue = node.nodeValue.replace(trimmed, map[trimmed]);
  }
  rootNode.querySelectorAll?.('[placeholder],[aria-label],[title]').forEach(element => {
    for (const attribute of ['placeholder', 'aria-label', 'title']) if (element.hasAttribute(attribute) && map[element.getAttribute(attribute)]) element.setAttribute(attribute, map[element.getAttribute(attribute)]);
  });
  document.documentElement.lang = qwhLanguage;
}
try { qwhLanguage = localStorage.getItem('quickwashhub:language') === 'or' ? 'or' : 'en'; } catch {}
const languageChoice = document.querySelector('#language-choice');
if (languageChoice) {
  languageChoice.value = qwhLanguage;
  languageChoice.addEventListener('change', () => { qwhLanguage = languageChoice.value === 'or' ? 'or' : 'en'; try { localStorage.setItem('quickwashhub:language', qwhLanguage); } catch {} applyQwhLanguage(); });
}
new MutationObserver(() => applyQwhLanguage()).observe(document.body, { childList: true, subtree: true });
applyQwhLanguage();

const previousAdminView = adminView;
adminView = function () {
  if (view === 'Zones & pricing') return zonesPage();
  if (view === 'Services') return servicesPage();
  if (view === 'Workers') return workersPage();
  if (view === 'Security') return heading('Admin security', 'Protect operations access with an authenticator app.') + '<section id="admin-mfa-state">Loading security settings…</section>';
  return previousAdminView();
};

const previousLoadAdminSection = loadAdminSection;
loadAdminSection = async function () {
  if (view === 'Zones & pricing') return loadZonesPage();
  if (view === 'Services') return loadServicesPage();
  if (view === 'Workers') return loadWorkersPage();
  if (view === 'Security') return loadAdminSecurity();
  if (view === 'Support desk' && me?.role === 'ADMIN') return loadSupportDesk();
  return previousLoadAdminSection();
};

async function loadAdminSecurity() {
  const state = document.querySelector('#admin-mfa-state');
  async function refresh() {
    const status = await api('/api/v1/admin/security/mfa');
    state.innerHTML = status.enabled
      ? panel('Authenticator MFA is on', '<p>Admin sign-ins require a current six-digit code from your authenticator app.</p><form id="mfa-disable-form" class="formrow"><label class="field"><span>Authenticator code to turn off MFA</span><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></label><button class="secondary">Turn off MFA</button></form>')
      : panel('Protect this admin account', '<p>Use an authenticator app such as Google Authenticator, Microsoft Authenticator, or 1Password. Setup requires your sign-in to continue on this device.</p><button class="primary" id="mfa-setup">Set up authenticator MFA</button>');
    document.querySelector('#mfa-setup')?.addEventListener('click', async () => {
      try {
        const setup = await api('/api/v1/admin/security/mfa/setup', { method: 'POST', body: JSON.stringify({}) });
        state.innerHTML = panel('Add QuickWashHub to your authenticator', '<p>In your authenticator app, add an account manually using this secret. It expires in 10 minutes.</p><label class="field"><span>Setup key</span><input readonly value="' + esc(setup.secret) + '" onclick="this.select()"></label><p class="fine">Account URI: <code>' + esc(setup.otpauthUrl) + '</code></p><form id="mfa-confirm-form" class="formrow"><label class="field"><span>Six-digit code from the app</span><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button class="primary">Confirm and enable MFA</button></form>');
        document.querySelector('#mfa-confirm-form').onsubmit = async event => { event.preventDefault(); try { await api('/api/v1/admin/security/mfa/confirm', { method: 'POST', body: JSON.stringify({ code: event.currentTarget.elements.code.value }) }); await refresh(); toast('Admin MFA enabled.'); } catch (error) { toast(error.message); } };
      } catch (error) { toast(error.message); }
    });
    document.querySelector('#mfa-disable-form')?.addEventListener('submit', async event => { event.preventDefault(); try { await api('/api/v1/admin/security/mfa/disable', { method: 'POST', body: JSON.stringify({ code: event.currentTarget.elements.code.value }) }); await refresh(); toast('Admin MFA disabled.'); } catch (error) { toast(error.message); } });
  }
  try { await refresh(); } catch (error) { state.innerHTML = panel('Security settings unavailable', '<p>' + esc(error.message) + '</p>'); }
}

const previousCustomerView = customerView;
customerView = function () {
  if (view === 'Support') return supportCustomerView();
  if (view !== 'Overview') return previousCustomerView();
  const next = bookings.find(b => !['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(b.status));
  const active = visibleCustomerServices(catalog.services).filter(s => s.category !== 'HOME');
  const cards = active.map(s => '<article class="simple-service"><div><span class="service-symbol">' + (s.category === 'SOLAR' ? '☼' : s.vehicleType === 'BIKE' ? '◈' : '◇') + '</span><strong>' + esc(s.name) + '</strong></div><small>' + (s.category === 'SOLAR' ? 'Residential or commercial · quote after site inspection' : esc(s.vehicleType) + ' · ' + s.durationMin + ' min') + ' · ' + esc(s.zoneName) + '</small><b>' + (s.category === 'SOLAR' ? 'Request quote' : money(s.price)) + '</b></article>').join('');
  return heading('Hello, ' + (me.name || 'there'), 'Book a convenient car, bike, or solar-panel wash.', '<button class="primary" data-book>Book a wash →</button>') +
    '<section class="simple-dashboard"><div class="simple-main">' + panel('Your next booking', next ? bookingRows([next]) : '<div class="empty-state"><b>No booking yet</b>Choose a service and book in a few steps.</div>') +
    '<div class="quick-links"><button class="secondary" data-nav="Vehicles">My vehicles</button><button class="secondary" data-nav="Addresses">My addresses</button><button class="secondary" data-nav="Support">Get help</button></div>' +
    (bookings.length > 1 ? panel('Recent bookings', bookingRows(bookings.filter(b => b !== next).slice(0, 3))) : '') +
    '</div><aside class="simple-services">' + panel('Services in your area', cards || '<p class="fine">Services are being set up for your zone.</p>') +
    '<article class="simple-service disabled-service"><div><span class="service-symbol">⌂</span><strong>Home Wash</strong></div><small>Coming later</small><b>Not available yet</b></article></aside></section>';
};
const previousNavigation = nav;
nav = function () {
  previousNavigation();
  if (me?.role === 'CUSTOMER' || me?.role === 'ADMIN') {
    const label = me.role === 'ADMIN' ? 'Support desk' : 'Support';
    for (const container of [document.querySelector('#nav'), document.querySelector('#mobile-nav')]) {
      if (!container || container.querySelector('[data-extra-nav="support"]')) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'navlink' + (view === label ? ' active' : ''); button.dataset.extraNav = 'support';
      button.innerHTML = '<span class="nav-icon" aria-hidden="true">?</span><span class="nav-label">' + label + '</span>';
      button.onclick = () => { view = label; render(); }; container.append(button);
    }
    if (me.role === 'ADMIN') for (const container of [document.querySelector('#nav'), document.querySelector('#mobile-nav')]) {
      if (!container || container.querySelector('[data-extra-nav="security"]')) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'navlink' + (view === 'Security' ? ' active' : ''); button.dataset.extraNav = 'security';
      button.innerHTML = '<span class="nav-icon" aria-hidden="true">◈</span><span class="nav-label">Security</span>';
      button.onclick = () => { view = 'Security'; render(); }; container.append(button);
    }
  }
};

const previousRender = render;
render = async function () {
  await previousRender();
  if (view === 'Support' && me?.role === 'CUSTOMER') bindSupportForm();
};

function supportCustomerView() {
  return heading('Help and support', 'Send a booking question and keep its reference number.') +
    panel('Contact QuickWashHub', '<form id="customer-support-form"><label class="field"><span>Booking (optional)</span><select name="bookingId"><option value="">General question</option>' +
      bookings.map(b => '<option value="' + esc(b.id) + '">' + esc(b.service) + ' · ' + esc(date(b.scheduledAt)) + '</option>').join('') +
      '</select></label><label class="field"><span>Subject</span><input name="subject" minlength="4" maxlength="120" required></label><label class="field"><span>How can we help?</span><textarea name="message" minlength="10" maxlength="4000" required></textarea></label><button class="primary">Send support request</button></form>') +
    panel('Your support requests', '<div id="customer-ticket-list">Loading requests…</div>') +
    panel('Account data', '<p>You can request account deletion. We will review any records that must be kept for payment or legal obligations.</p><button class="secondary" id="request-account-deletion">Request account deletion</button>');
}

function bindSupportForm() {
  const form = document.querySelector('#customer-support-form'); if (!form || form.dataset.bound) return; form.dataset.bound = 'true';
  form.onsubmit = async event => {
    event.preventDefault(); const data = new FormData(form); const bookingId = data.get('bookingId');
    try { const ticket = await api('/api/v1/support/tickets', { method: 'POST', body: JSON.stringify({ ...(bookingId ? { bookingId } : {}), subject: data.get('subject'), message: data.get('message') }) }); toast('Request sent. Reference: ' + ticket.reference); await loadCustomerTickets(); form.reset(); }
    catch (error) { toast(error.message); }
  };
  document.querySelector('#request-account-deletion').onclick = async () => {
    if (!confirm('Send an account deletion request to QuickWashHub?')) return;
    try { const result = await api('/api/v1/account/deletion-request', { method: 'POST', body: JSON.stringify({}) }); toast(result.message); }
    catch (error) { toast(error.message); }
  };
  loadCustomerTickets().catch(error => toast(error.message));
}

async function loadCustomerTickets() {
  const target = document.querySelector('#customer-ticket-list'); if (!target) return;
  const tickets = await api('/api/v1/support/tickets');
  target.innerHTML = tickets.length ? tickets.map(t => '<div class="row"><div class="info"><strong>' + esc(t.reference) + ' · ' + esc(t.subject) + '</strong><small>' + esc(t.status) + ' · ' + esc(date(t.createdAt)) + '</small></div></div>').join('') : '<p class="fine">No support requests yet.</p>';
}

async function loadSupportDesk() {
  const [tickets, deletion] = await Promise.all([api('/api/v1/admin/support/tickets'), api('/api/v1/admin/account-deletion-requests')]);
  document.querySelector('#content').innerHTML = heading('Support desk', 'Review customer issues and account deletion requests.') +
    panel('Open support tickets', tickets.map(t => '<article class="support-ticket"><div><strong>' + esc(t.reference) + ' · ' + esc(t.subject) + '</strong><small>' + esc(t.customer.name || t.customer.email || t.customer.phone || '') + ' · ' + esc(date(t.createdAt)) + '</small><p>' + esc(t.message) + '</p>' + (t.booking ? '<small>Booking ' + esc(t.booking.id) + ' · ' + esc(t.booking.status) + '</small>' : '') + '</div><label class="field"><span>Status</span><select data-ticket-status="' + esc(t.id) + '"><option ' + (t.status === 'OPEN' ? 'selected' : '') + '>OPEN</option><option ' + (t.status === 'IN_REVIEW' ? 'selected' : '') + '>IN_REVIEW</option><option ' + (t.status === 'RESOLVED' ? 'selected' : '') + '>RESOLVED</option></select></label></article>').join('') || '<p class="fine">No tickets yet.</p>') +
    panel('Account deletion requests', deletion.map(d => '<div class="row"><div class="info"><strong>' + esc(d.user.name || d.user.email || d.user.phone || d.user.id) + '</strong><small>' + esc(d.status) + ' · ' + esc(date(d.createdAt)) + (d.reason ? ' · ' + esc(d.reason) : '') + '</small></div></div>').join('') || '<p class="fine">No pending requests.</p>');
  document.querySelectorAll('[data-ticket-status]').forEach(select => select.onchange = async () => {
    try { await api('/api/v1/admin/support/tickets/' + encodeURIComponent(select.dataset.ticketStatus), { method: 'PATCH', body: JSON.stringify({ status: select.value }) }); toast('Ticket status saved'); }
    catch (error) { toast(error.message); }
  });
}

function servicesPage() {
  return heading('Services and prices', 'Set the vehicle wash menu and add quote-based Solar Wash.') +
    panel('Add a service', '<form id="service-form" class="formrow"><label class="field"><span>Service name</span><input name="name" required maxlength="100"></label>' +
      '<label class="field"><span>Category</span><select name="category" id="service-category"><option value="VEHICLE">Car or bike wash</option><option value="SOLAR">Solar panels · quote after inspection</option><option value="HOME">Home Wash · off for beta</option></select></label>' +
      '<label class="field" id="service-vehicle-wrap"><span>Vehicle type</span><select name="vehicleType"><option>CAR</option><option>BIKE</option></select></label>' +
      '<label class="field"><span>Expected duration (minutes)</span><input name="durationMin" type="number" min="5" max="600" value="90" required></label>' +
      '<button class="primary">Add service</button></form>') + '<section id="services-state">Loading services…</section>';
}

async function loadServicesPage() {
  const [services, zones] = await Promise.all([api('/api/v1/admin/services'), api('/api/v1/admin/zones')]);
  const serviceGroups = new Map();
  for (const service of services) {
    const key = service.category === 'SOLAR' ? 'SOLAR' : [service.category, service.vehicleType || '', service.name.trim().toLocaleLowerCase().replace(/\s+/g, ' ')].join('|');
    serviceGroups.set(key, [...(serviceGroups.get(key) || []), service]);
  }
  const duplicateServices = [...serviceGroups.values()].filter(group => group.length > 1);
  const duplicateNotice = duplicateServices.length ? '<div class="admin-warning"><strong>Possible duplicate services need review</strong><p>' + duplicateServices.map(group => group.map(s => esc(s.name) + ' (' + (s.isActive ? 'active' : 'inactive') + ')').join(' · ')).join('<br>') + '</p><small>Deactivate the extra entries after checking their zone prices and booking history. Existing records are kept intact.</small></div>' : '';
  const form = document.querySelector('#service-form'), category = form.elements.category;
  category.onchange = () => document.querySelector('#service-vehicle-wrap').classList.toggle('hidden', category.value !== 'VEHICLE');
  form.addEventListener('submit', async event => {
    event.preventDefault(); event.stopImmediatePropagation();
    const data = new FormData(form), kind = String(data.get('category'));
    const payload = { name: data.get('name'), category: kind, durationMin: Number(data.get('durationMin')), isActive: kind !== 'HOME' };
    if (kind === 'VEHICLE') payload.vehicleType = data.get('vehicleType');
    try { await api('/api/v1/admin/services', { method: 'POST', body: JSON.stringify(payload) }); await render(); toast(kind === 'SOLAR' ? 'Solar quote service added' : kind === 'HOME' ? 'Home Wash saved as inactive' : 'Service added'); }
    catch (error) { toast(error.message); }
  }, true);
  document.querySelector('#services-state').innerHTML = duplicateNotice + panel('Service catalogue', services.map(s =>
    '<div class="row"><div class="info"><strong>' + esc(s.name) + '</strong><small>' + esc(s.category) + (s.vehicleType ? ' · ' + esc(s.vehicleType) : '') + ' · ' + s.durationMin + ' min · ' + (s.isActive ? 'active' : 'inactive') +
    (s.category === 'SOLAR' ? ' · final quote after site inspection' : '') + '</small></div><button class="secondary" data-service-toggle="' + esc(s.id) + '" data-active="' + s.isActive + '">' + (s.isActive ? 'Deactivate' : 'Activate') + '</button></div>').join('')) +
    panel('Set immediate vehicle wash prices', '<form id="price-form" class="formrow"><label class="field"><span>Zone</span><select name="zoneId">' + zones.map(z => '<option value="' + esc(z.id) + '">' + esc(z.name) + '</option>').join('') + '</select></label><label class="field"><span>Vehicle wash service</span><select name="serviceId">' + services.filter(s => s.category === 'VEHICLE' && s.vehicleType).map(s => '<option value="' + esc(s.id) + '" data-type="' + esc(s.vehicleType) + '">' + esc(s.name) + ' · ' + esc(s.vehicleType) + '</option>').join('') + '</select></label><label class="field"><span>Price (₹)</span><input name="price" type="number" min="1" step="1" required></label><button class="primary">Save zone price</button></form>') +
    '<p class="form-help">Solar Wash does not get an upfront zone price. Review the site request and send a final quote from Bookings.</p>';
  document.querySelector('#price-form')?.addEventListener('submit', async event => {
    event.preventDefault(); event.stopImmediatePropagation(); const f = new FormData(event.currentTarget), type = event.currentTarget.elements.serviceId.selectedOptions[0]?.dataset.type;
    try { await api('/api/v1/admin/zones/' + encodeURIComponent(f.get('zoneId')) + '/prices/' + encodeURIComponent(f.get('serviceId')), { method: 'PUT', body: JSON.stringify({ price: Math.round(Number(f.get('price')) * 100), vehicleType: type }) }); await render(); toast('Zone price saved'); }
    catch (error) { toast(error.message); }
  }, true);
  document.querySelectorAll('[data-service-toggle]').forEach(button => button.onclick = async () => {
    try { await api('/api/v1/admin/services/' + encodeURIComponent(button.dataset.serviceToggle), { method: 'PATCH', body: JSON.stringify({ isActive: button.dataset.active !== 'true' }) }); await render(); }
    catch (error) { toast(error.message); }
  });
}

function workersPage() {
  return heading('Worker partners', 'Approve onboarding and mark solar-qualified partners only after safety checks.') +
    panel('Add worker', '<form id="worker-form" class="formrow"><label class="field"><span>Name</span><input name="name" required></label><label class="field"><span>Email</span><input name="email" type="email" required></label><label class="field"><span>Worker type</span><select name="type"><option>PERMANENT</option><option>TEMP</option></select></label><button class="primary">Add worker</button></form>') + '<section id="admin-workers">Loading workers…</section>';
}

async function loadWorkersPage() {
  const workers = await api('/api/v1/admin/workers');
  document.querySelector('#admin-workers').innerHTML = panel('Worker list', workers.map(w =>
    '<div class="row"><div class="info"><strong>' + esc(w.user.name || w.user.email) + '</strong><small>' + esc(w.type) + ' · Account ' + (w.user.isActive ? 'active' : 'blocked') + ' · KYC ' + esc(w.kycStatus) + ' · ' + (w.isOnline ? 'online' : 'offline') + ' · Zones: ' + esc(w.zones.map(z => z.zone.name).join(', ') || 'none assigned') + ' · Solar ' + (w.solarQualified ? 'qualified' : 'not qualified') + ' · Cashfree vendor ' + esc(w.cashfreeVendorId || 'not set') + '</small></div>' +
    (w.kycStatus !== 'APPROVED' ? '<button class="secondary" data-kyc="' + esc(w.id) + '">Approve KYC</button>' : '') +
    '<button class="secondary" data-solar-qualified="' + esc(w.id) + '" data-qualified="' + w.solarQualified + '">' + (w.solarQualified ? 'Remove solar qualification' : 'Mark solar-qualified') + '</button>' +
    '<button class="secondary" data-cashfree-vendor="' + esc(w.id) + '" data-current-vendor="' + esc(w.cashfreeVendorId || '') + '">' + (w.cashfreeVendorId ? 'Update Cashfree vendor ID' : 'Set Cashfree vendor ID') + '</button>' +
    '<button class="secondary" data-block="' + esc(w.id) + '">Block</button></div>').join(''));
  document.querySelector('#worker-form').addEventListener('submit', async event => {
    event.preventDefault(); event.stopImmediatePropagation();
    try { await api('/api/v1/admin/workers', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await render(); toast('Worker account created'); }
    catch (error) { toast(error.message); }
  }, true);
  document.querySelectorAll('[data-solar-qualified]').forEach(button => button.onclick = async () => {
    try { await api('/api/v1/admin/workers/' + encodeURIComponent(button.dataset.solarQualified) + '/solar-qualification', { method: 'PATCH', body: JSON.stringify({ qualified: button.dataset.qualified !== 'true' }) }); await render(); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-cashfree-vendor]').forEach(button => button.onclick = async () => {
    const vendorId = window.prompt('Enter the vendor ID verified in Cashfree Easy Split:', button.dataset.currentVendor || '');
    if (!vendorId?.trim()) return;
    try { await api('/api/v1/admin/workers/' + encodeURIComponent(button.dataset.cashfreeVendor) + '/cashfree-vendor', { method: 'PATCH', body: JSON.stringify({ vendorId: vendorId.trim() }) }); await render(); toast('Cashfree vendor ID saved'); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-kyc]').forEach(button => button.onclick = async () => {
    try { await api('/api/v1/admin/workers/' + encodeURIComponent(button.dataset.kyc) + '/kyc', { method: 'PATCH', body: JSON.stringify({ status: 'APPROVED' }) }); await render(); }
    catch (error) { toast(error.message); }
  });
  document.querySelectorAll('[data-block]').forEach(button => button.onclick = async () => {
    try { await api('/api/v1/admin/workers/' + encodeURIComponent(button.dataset.block) + '/block', { method: 'PATCH' }); await render(); }
    catch (error) { toast(error.message); }
  });
}

function zonesPage() {
  return heading('Service zones', 'Place a center on the map and set its coverage radius.') +
    panel('Create or edit zone', '<form id="zone-form" class="zone-editor">' +
      '<label class="field"><span>Zone name</span><input name="name" placeholder="Cuttack 42 Mouza" required maxlength="100"></label>' +
      '<label class="field"><span>Base commission (%)</span><input name="baseCommissionPct" type="number" min="0" max="100" step="0.1" value="20" required></label>' +
      '<label class="field"><span>Minimum contribution after coupon (%)</span><input name="couponMinimumContributionPct" type="number" min="0" max="20" step="0.1" value="1" required><small class="form-help">Coupons stop at the zone margin left after partner payout and payment fees.</small></label>' +
      '<div class="zone-map-toolbar"><label class="field"><span>Coverage radius (km)</span><input name="radiusKm" id="zone-radius" type="number" min="0.25" max="30" step="0.25" value="3" required></label>' +
      '<button class="secondary" id="zone-use-location" type="button">◎ Use my location</button><span id="zone-center-status" class="fine">Click the map to place the zone center.</span></div>' +
      '<div id="admin-zone-map" role="application" aria-label="Choose a circular service zone on the map"></div>' +
      '<input type="hidden" name="centerLat"><input type="hidden" name="centerLng">' +
      '<p class="form-help">Check that the circle stays inside the 42 Mouza beta area before activating this zone.</p>' +
      '<div class="formrow"><button class="primary" id="zone-save">Create zone</button><button class="secondary hidden" id="zone-cancel-edit" type="button">Cancel edit</button></div>' +
      '</form>') + '<section id="zones-state">Loading zones…</section>';
}

async function loadZonesPage() {
  const [zones, workers, config] = await Promise.all([
    api('/api/v1/admin/zones'), api('/api/v1/admin/workers'), api('/api/v1/admin/zones/config')
  ]);
  const mapZones = zones.filter(z => z.centerLat != null && z.centerLng != null && Number.isFinite(Number(z.centerLat)) && Number.isFinite(Number(z.centerLng)) && Number(z.radiusKm) > 0);
  const overlaps = [];
  for (let i = 0; i < mapZones.length; i++) for (let j = i + 1; j < mapZones.length; j++) {
    const a = mapZones[i], b = mapZones[j], rad = value => value * Math.PI / 180;
    const dLat = rad(Number(b.centerLat) - Number(a.centerLat)), dLng = rad(Number(b.centerLng) - Number(a.centerLng));
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(Number(a.centerLat))) * Math.cos(rad(Number(b.centerLat))) * Math.sin(dLng / 2) ** 2;
    const distance = 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    if (distance < Number(a.radiusKm) + Number(b.radiusKm)) overlaps.push(a.name + ' ↔ ' + b.name + ' · ' + (a.isActive && b.isActive ? 'both active' : 'one inactive'));
  }
  const overlapNotice = overlaps.length ? '<div class="admin-warning"><strong>Zone coverage overlaps</strong><p>' + overlaps.map(esc).join('<br>') + '</p><small>Overlaps between active zones can affect booking pricing and worker eligibility. Review inactive overlaps before activating them.</small></div>' : '';
  document.querySelector('#zones-state').innerHTML = overlapNotice + panel('Configured service zones', zones.map(z =>
    '<div class="row"><div class="info"><strong>' + esc(z.name) + '</strong><small>' +
    (z.radiusKm ? esc(z.radiusKm) + ' km radius' : 'Old polygon zone · choose a center and radius to edit') +
    ' · ' + esc(z.baseCommissionPct) + '% commission · ' + esc(z.couponMinimumContributionPct ?? 1) + '% minimum contribution · ' + (z.isActive ? 'active' : 'inactive') +
    '</small></div><button class="secondary" data-zone-edit="' + esc(z.id) + '">Edit map</button>' +
    '<button class="secondary" data-zone-toggle="' + esc(z.id) + '" data-active="' + z.isActive + '">' +
    (z.isActive ? 'Deactivate' : 'Activate') + '</button></div>').join('')) +
    panel('Assign workers to a zone', '<form id="worker-zone-form" class="formrow"><label class="field"><span>Worker</span><select name="workerId">' +
      workers.map(w => '<option value="' + esc(w.id) + '">' + esc(w.user.name || w.user.email) + '</option>').join('') +
      '</select></label><label class="field"><span>Zone</span><select name="zoneId">' +
      zones.map(z => '<option value="' + esc(z.id) + '">' + esc(z.name) + '</option>').join('') +
      '</select></label><button class="primary">Assign zone</button></form>');

  const form = document.querySelector('#zone-form');
  const radius = document.querySelector('#zone-radius');
  radius.addEventListener('input', drawAdminZoneCircle);
  document.querySelector('#zone-use-location').onclick = () => navigator.geolocation?.getCurrentPosition(
    p => setAdminZoneCenter(p.coords.latitude, p.coords.longitude, true),
    () => toast('Could not read your location. Click the map to choose a center.'),
    { enableHighAccuracy: true, timeout: 10000 }
  );
  document.querySelector('#zone-cancel-edit').onclick = () => {
    adminZoneEditingId = null; form.reset(); radius.value = '3';
    document.querySelector('#zone-save').textContent = 'Create zone';
    document.querySelector('#zone-cancel-edit').classList.add('hidden');
    document.querySelector('#zone-center-status').textContent = 'Click the map to place the zone center.';
    setAdminZoneCenter(20.4625, 85.883, false);
  };
  form.addEventListener('submit', async event => {
    event.preventDefault(); event.stopImmediatePropagation();
    const centerLat = Number(form.elements.centerLat.value), centerLng = Number(form.elements.centerLng.value);
    if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return toast('Click the map to choose a zone center.');
    const payload = { name: form.elements.name.value, baseCommissionPct: Number(form.elements.baseCommissionPct.value), couponMinimumContributionPct: Number(form.elements.couponMinimumContributionPct.value), centerLat, centerLng, radiusKm: Number(form.elements.radiusKm.value) };
    try {
      await api(adminZoneEditingId ? '/api/v1/admin/zones/' + encodeURIComponent(adminZoneEditingId) : '/api/v1/admin/zones', {
        method: adminZoneEditingId ? 'PATCH' : 'POST', body: JSON.stringify(payload)
      });
      adminZoneEditingId = null; await render(); toast('Zone saved');
    } catch (error) { toast(error.message); }
  }, true);

  document.querySelectorAll('[data-zone-edit]').forEach(button => button.onclick = () => {
    const zone = zones.find(item => item.id === button.dataset.zoneEdit); if (!zone) return;
    adminZoneEditingId = zone.id; form.elements.name.value = zone.name;
    form.elements.baseCommissionPct.value = String(zone.baseCommissionPct); form.elements.couponMinimumContributionPct.value = String(zone.couponMinimumContributionPct ?? 1); radius.value = String(zone.radiusKm || 3);
    document.querySelector('#zone-save').textContent = 'Save zone';
    document.querySelector('#zone-cancel-edit').classList.remove('hidden');
    setAdminZoneCenter(zone.centerLat ?? 20.4625, zone.centerLng ?? 85.883, true);
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.querySelectorAll('[data-zone-toggle]').forEach(button => button.onclick = async () => {
    try { await api('/api/v1/admin/zones/' + encodeURIComponent(button.dataset.zoneToggle), { method: 'PATCH', body: JSON.stringify({ isActive: button.dataset.active !== 'true' }) }); await render(); }
    catch (error) { toast(error.message); }
  });
  document.querySelector('#worker-zone-form')?.addEventListener('submit', async event => {
    event.preventDefault(); event.stopImmediatePropagation(); const data = new FormData(event.currentTarget);
    try { await api('/api/v1/admin/workers/' + encodeURIComponent(data.get('workerId')) + '/zones/' + encodeURIComponent(data.get('zoneId')), { method: 'PUT' }); await render(); toast('Worker assigned to zone. They must still be KYC-approved and online to receive jobs.'); }
    catch (error) { toast(error.message); }
  }, true);

  if (!config.googleMapsApiKey) { document.querySelector('#admin-zone-map').innerHTML = '<div class="map-key-message">Add GOOGLE_MAPS_API_KEY to enable the zone map.</div>'; return; }
  try {
    await loadAdminZoneMap(config.googleMapsApiKey);
    const element = document.querySelector('#admin-zone-map'); if (!element) return;
    adminZoneMap = new google.maps.Map(element, { center: { lat: 20.4625, lng: 85.883 }, zoom: 13, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
    adminZoneMarker = new google.maps.Marker({ map: adminZoneMap, draggable: true, title: 'Zone center' });
    adminZoneCircle = new google.maps.Circle({ map: adminZoneMap, strokeColor: '#176b4b', strokeOpacity: .9, strokeWeight: 2, fillColor: '#176b4b', fillOpacity: .14 });
    adminZoneMap.addListener('click', e => e.latLng && setAdminZoneCenter(e.latLng.lat(), e.latLng.lng(), true));
    adminZoneMarker.addListener('dragend', e => e.latLng && setAdminZoneCenter(e.latLng.lat(), e.latLng.lng(), true));
    drawAdminZoneCircle();
  } catch { document.querySelector('#admin-zone-map').innerHTML = '<div class="map-key-message">Google Maps could not load. Check API key, billing, and website restrictions.</div>'; }
}

function loadAdminZoneMap(key) {
  if (window.google?.maps) return Promise.resolve();
  if (adminZoneMapPromise) return adminZoneMapPromise;
  adminZoneMapPromise = new Promise((resolve, reject) => {
    window.quickWashHubAdminMapsReady = resolve;
    const script = document.createElement('script');
    script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&loading=async&callback=quickWashHubAdminMapsReady';
    script.async = true; script.onerror = reject; document.head.append(script);
  });
  return adminZoneMapPromise;
}

function setAdminZoneCenter(lat, lng, pan) {
  const form = document.querySelector('#zone-form'); if (!form) return;
  form.elements.centerLat.value = String(lat); form.elements.centerLng.value = String(lng);
  document.querySelector('#zone-center-status').textContent = 'Zone center selected.';
  if (adminZoneMarker) { adminZoneMarker.setPosition({ lat, lng }); if (pan) adminZoneMap?.panTo({ lat, lng }); }
  drawAdminZoneCircle();
}

function drawAdminZoneCircle() {
  if (!adminZoneCircle || !adminZoneMarker) return;
  const form = document.querySelector('#zone-form'); if (!form) return;
  const lat = Number(form.elements.centerLat.value), lng = Number(form.elements.centerLng.value), radiusKm = Number(form.elements.radiusKm.value) || 0;
  if (Number.isFinite(lat) && Number.isFinite(lng)) { adminZoneCircle.setCenter({ lat, lng }); adminZoneCircle.setRadius(radiusKm * 1000); adminZoneCircle.setVisible(true); }
  else adminZoneCircle.setVisible(false);
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-quote]'); if (!button || me?.role !== 'ADMIN') return;
  event.preventDefault();
  try {
    const rows = await api('/api/v1/admin/bookings?status=QUOTE_REQUESTED');
    const booking = rows.find(row => row.id === button.dataset.quote); if (!booking) return toast('Quote request no longer exists. Refresh and retry.');
    const modal = document.createElement('div'); modal.className = 'backdrop';
    modal.innerHTML = '<div class="modal"><div class="modalhead"><div><div class="eyebrow">SOLAR SITE REVIEW</div><h2>Send a final quote</h2><p>' + esc(booking.customer.name || booking.customer.email || booking.customer.phone || '') + ' · ' + esc(booking.address.fullAddress) + '</p></div><button class="close" type="button">×</button></div><p><b>Property:</b> ' + esc(booking.solarPropertyType) + ' · <b>Panels:</b> ' + esc(booking.solarPanelCount || 'Not provided') + '</p><p><b>Roof/access:</b> ' + esc(booking.solarRoofType) + '</p><p><b>Customer notes:</b> ' + esc(booking.solarAccessNotes || 'None') + '</p><form id="quote-form"><label class="field"><span>Inspected final price (₹)</span><input name="amount" type="number" min="1" step="1" required></label><label class="field"><span>Inspection summary and quote details</span><textarea name="note" minlength="5" maxlength="1000" required></textarea></label><button class="primary">Send quote to customer</button></form></div>';
    document.body.append(modal); modal.querySelector('.close').onclick = () => modal.remove();
    modal.querySelector('#quote-form').onsubmit = async submit => {
      submit.preventDefault(); const form = new FormData(submit.currentTarget);
      try { await api('/api/v1/admin/bookings/' + encodeURIComponent(booking.id) + '/quote', { method: 'POST', body: JSON.stringify({ amount: Math.round(Number(form.get('amount')) * 100), note: form.get('note') }) }); modal.remove(); await render(); toast('Quote sent. Customer can review and pay.'); }
      catch (error) { toast(error.message); }
    };
  } catch (error) { toast(error.message); }
});
