// A small stand-in for a Workday application: one step at a time, a footer button
// (data-automation-id="bottom-navigation-next-button") that says Continue / Save and Continue / Submit.
// Step 1 is only a resume drop box: the upload "reads" the file for 1.5 s, and Continue does nothing meanwhile.
// A step with an empty required box shows an error and does not move on.
const app = document.getElementById('app');
const state = { step: 0, resume: '', uploading: false, values: {} };
window.__wd = state;
const STEPS = [
  { title: 'Autofill with Resume', button: 'Continue', html: () => `
      <p>Upload either DOC, DOCX, HTML, PDF, or TXT file types (5MB max)</p>
      <div data-automation-id="file-upload-drop-zone" style="border:2px dashed #aaa;padding:20px">Drop file here or
        <label>Select file<input type="file" data-automation-id="file-upload-input-ref" style="position:absolute;width:1px;height:1px;opacity:0"></label></div>
      <div id="upload-state">${state.uploading ? '<div role="progressbar">Uploading...</div>' : state.resume ? `Successfully Uploaded: <span id="resume-name">${state.resume}</span>` : ''}</div>` },
  { title: 'My Information', button: 'Save and Continue', required: ['legalName--firstName', 'legalName--lastName', 'email'], html: () => `
      <div><label for="legalName--firstName">First Name<abbr title="required">*</abbr></label><input id="legalName--firstName" aria-required="true" value="${state.values['legalName--firstName'] || ''}"></div>
      <div><label for="legalName--lastName">Last Name<abbr title="required">*</abbr></label><input id="legalName--lastName" aria-required="true" value="${state.values['legalName--lastName'] || ''}"></div>
      <div><label for="email">Email Address<abbr title="required">*</abbr></label><input id="email" aria-required="true" value="${state.values.email || ''}"></div>` },
  { title: 'Application Questions', button: 'Save and Continue', required: ['spon'], html: () => `
      <fieldset><legend>Will you now or in the future require sponsorship for employment visa status? *</legend>
        <label><input type="radio" name="spon" value="Yes" required> Yes</label><label><input type="radio" name="spon" value="No"> No</label></fieldset>` },
  { title: 'Review', button: 'Submit', html: () => `<p>Check your application.</p><p id="rv-resume">Resume: ${state.resume || 'none'}</p><p>Name: ${state.values['legalName--firstName'] || ''} ${state.values['legalName--lastName'] || ''}</p>` },
];
function draw(error = '') {
  const st = STEPS[state.step];
  app.innerHTML = `<h2 data-automation-id="pageHeaderTitle">${st.title}</h2>${error ? `<div role="alert" class="error">${error}</div>` : ''}<form onsubmit="return false">${st.html()}</form>
    <div><button type="button" data-automation-id="bottom-navigation-next-button">${st.button}</button></div>`;
  const file = app.querySelector('input[type=file]');
  if (file) file.addEventListener('change', () => {
    if (!file.files.length) return;
    state.uploading = true; draw();
    setTimeout(() => { state.uploading = false; state.resume = file.files[0].name; draw(); }, 1500);
  });
  app.querySelector('[data-automation-id="bottom-navigation-next-button"]').addEventListener('click', next);
}
function next() {
  const st = STEPS[state.step];
  if (state.uploading) return; // still reading the resume
  for (const id of st.required || []) {
    const el = document.getElementById(id);
    const v = el ? el.value : [...document.querySelectorAll(`input[name=${id}]`)].find((r) => r.checked)?.value;
    if (!v) return draw(`Error: ${id === 'spon' ? 'The sponsorship question' : 'The field'} is required and must have a value.`);
    state.values[id] = v;
  }
  if (st.button === 'Submit') { document.body.innerHTML = '<h1>Thank you for applying!</h1><p>Your application has been submitted.</p>'; return; }
  state.step++;
  draw();
}
draw();
