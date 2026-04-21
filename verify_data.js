const s_id='a21bec52-61ac-4216-ade2-d01b76cd563c';
const c_ids=['75c1c10a-9557-43cc-8d9b-ba379a93e025', '4a28cab5-51e7-47aa-ac9d-6533e8f5e7c5'];
const base='https://erp-system-prod-1glmda1zf4f9c7a7-1367197884.ap-shanghai.app.tcloudbase.com/api-bridge';

(async () => {
  async function check(path, id) {
    try {
      const url = base + path + '?id=' + id + '&withDeleted=true';
      console.log('Fetching', url);
      const r = await fetch(url, {headers:{'x-client-platform':'web'}});
      if (!r.ok) {
        console.log(id + ' Error Status: ' + r.status);
        return;
      }
      const json = await r.json();
      const d = json.data || {};
      console.log(id + ' -> Status: ' + (d.status||'N/A') + ', Deleted: ' + (d.deleted||d.isDeleted||'false') + ', Name: ' + (d.name||d.companyName||'N/A'));
    } catch(e) { console.log(id + ' Error: ' + e.message); }
  }

  await check('/suppliers', s_id);
  for(const id of c_ids) await check('/customers', id);
})();
