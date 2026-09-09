// diagnostico-grupos.js
(async () => {
  const people = await db.listPeople();
  const depts = await db.listDepartments();
  console.log('Departamentos:', depts.map(d=>({id:d.id,name:d.name})));
  console.log('Total personas:', people.length);
  const byGroup = {};
  people.forEach(p => {
    const g = String(p.grupoId||'');
    byGroup[g] = (byGroup[g]||0)+1;
  });
  console.log('Personas por grupoId:', byGroup);
  // Verificar coincidencia
  depts.forEach(d => {
    const cnt = byGroup[String(d.id)]||0;
    console.log(`Grupo ${d.id} ${d.name} -> ${cnt} personas`);
  });
})();
