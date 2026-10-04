// All views consume the same generated mod-first artwork catalog.
window.BKItemArt = {
  resolve(item, catalog, classic = false) {
    const quality = (item.quality || '').toLowerCase();
    const group = quality === 'unique' ? 'uniques' : quality === 'set' ? 'sets' : 'codes';
    const id = quality === 'unique' ? item.uniqueId : item.setId;
    const names = [id == null ? null : String(id), (item.name || item.displayName || '').split('(')[0].trim().toLowerCase()];
    const keys = group === 'codes' ? [item.itemCode?.trim()] : names;
    const candidates = [...keys.filter(Boolean).map(key => [group, key]), ['codes', item.itemCode?.trim()]];
    for (const [kind, key] of candidates) {
      if (!key || !catalog?.[kind]?.[key]) continue;
      const identity = kind + ':' + key;
      const tier = { Normal: 'normal', Exceptional: 'uber', Elite: 'ultra' }[item.tier] || 'normal';
      let file = classic ? catalog['classic_' + kind]?.[key] || catalog[kind][key]
        : catalog.variants?.[identity]?.[tier] || catalog[kind][key];
      if (file === 'invchm.png' || key === '438' || item.itemCode?.trim() === 'mfc') {
        file = 'hd_charm_charm_modifiers.png';
      }
      return {file, identity, ...catalog.provenance?.[identity]};
    }
    if (item.itemCode?.trim() === 'mfc' || item.uniqueId === 438) {
      return {file: 'hd_charm_charm_modifiers.png', identity: 'uniques:438', source: 'BKDiablo'};
    }
    return {file:null,source:'unmatched'};
  }
};
