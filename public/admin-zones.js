let adminZoneMap = null;
let adminZoneMarker = null;
let adminZoneCircle = null;
let adminZoneEditingId = null;
let adminZoneMapPromise = null;

const previousAdminView = adminView;
adminView = function () {
  if (view === 'Zones & pricing') return zonesPage();
  if (view === 'Services') return servicesPage();
  if (view === 'Workers') return workersPage();
  return previousAdminView();
};

const previousLoadAdminSection = loadAdminSection;
loadAdminSection = async function () {
  if (view === 'Zones & pricing') return loadZonesPage();
  if (view === 'Services') return loadServicesPage();
  if (view === 'Workers') return loadWorkersPage();
  if (view === 'Support desk' && me?.role === 'ADMIN') return loadSupportDesk();
  return previousLoadAdminSection();
};

const previousCustomerView = customerView;
customerView = function () {
  if (view === 'Support') return supportCustomerView();
  if (view !== 'Overview') return previousCustomerView();
  const next = bookings.find(b => !['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(b.status));
  const active = catalog.services.filter(s => s.category !== 'HOME');
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
  document.querySelector('#services-state').innerHTML = panel('Service catalogue', services.map(s =>
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
    '<div class="row"><div class="info"><strong>' + esc(w.user.name || w.user.email) + '</strong><small>' + esc(w.type) + ' · KYC ' + esc(w.kycStatus) + ' · ' + (w.isOnline ? 'online' : 'offline') + ' · Solar ' + (w.solarQualified ? 'qualified' : 'not qualified') + ' · Cashfree vendor ' + esc(w.cashfreeVendorId || 'not set') + '</small></div>' +
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
  document.querySelector('#zones-state').innerHTML = panel('Configured service zones', zones.map(z =>
    '<div class="row"><div class="info"><strong>' + esc(z.name) + '</strong><small>' +
    (z.radiusKm ? esc(z.radiusKm) + ' km radius' : 'Old polygon zone · choose a center and radius to edit') +
    ' · ' + esc(z.baseCommissionPct) + '% commission · ' + (z.isActive ? 'active' : 'inactive') +
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
    const payload = { name: form.elements.name.value, baseCommissionPct: Number(form.elements.baseCommissionPct.value), centerLat, centerLng, radiusKm: Number(form.elements.radiusKm.value) };
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
    form.elements.baseCommissionPct.value = String(zone.baseCommissionPct); radius.value = String(zone.radiusKm || 3);
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
    try { await api('/api/v1/admin/workers/' + encodeURIComponent(data.get('workerId')) + '/zones/' + encodeURIComponent(data.get('zoneId')), { method: 'PUT' }); toast('Worker assigned to zone'); }
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
