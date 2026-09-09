// reparar-grupos.js
// Ejecuta en consola del navegador con la app abierta en la vista Informes
// Corrige grupoId de participantes cuando los grupos cambiaron de id:
// 8→2, 9→3, 10→4, 11→5, 12→6, 13→7
// Actualiza IndexedDB y Supabase.

const mapping = { '8':'2','9':'3','10':'4','11':'5','12':'6','13':'7' };

(async () => {
  const db = window.db;
  if (!db) { console.error('db no disponible'); return; }
  const f = await import('./supabase.js?v=219');
  const people = await db.listPeople();
  let changed = 0;
  for (const p of people) {
    const oldGid = String(p.grupoId||'');
    const newGid = mapping[oldGid];
    if (newGid && newGid !== oldGid) {
      const upd = { ...p, grupoId: newGid };
      await db.putPersonSilent(upd);
      // Supabase
      try {
        await f.guardarParticipante(String(p.id), { ...p, grupoId: newGid });
      } catch(e){ console.warn('Supabase update fail', p.id, e); }
      changed++;
      console.log(`Persona ${p.id} ${p.name}: ${oldGid}→${newGid}`);
    }
  }
  console.log(`Reparados ${changed} participantes`);
  // Refrescar UI
  if (window.state) {
    window.state.people = await db.listPeople();
    if (window.renderInformes) window.renderInformes();
  }
})();
