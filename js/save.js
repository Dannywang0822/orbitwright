// localStorage keys required by the v1 spec.
OW.SAVE_KEY = "orbitwright-v1";
OW.DRAFT_KEY = "orbitwright-hangar-draft";

OW.defaultSave = function () {
  return {
    moonCleared: false,
    orbitReached: false,
    bestCraftJson: null,
    settings: { muted: true },
  };
};

OW.loadSave = function () {
  var base = OW.defaultSave();
  try {
    var raw = localStorage.getItem(OW.SAVE_KEY);
    if (!raw) return base;
    var data = JSON.parse(raw);
    if (!data || typeof data !== "object") return base;
    base.moonCleared = !!data.moonCleared;
    base.orbitReached = !!(data.orbitReached || (data.unlocks && data.unlocks.engVac));
    base.bestCraftJson = data.bestCraftJson || null;
    if (data.settings) base.settings.muted = data.settings.muted !== false;
    return base;
  } catch (e) {
    return base;
  }
};

OW.writeSave = function (data) {
  try {
    localStorage.setItem(OW.SAVE_KEY, JSON.stringify({
      moonCleared: !!data.moonCleared,
      orbitReached: !!data.orbitReached,
      bestCraftJson: data.bestCraftJson || null,
      settings: { muted: !data.settings || data.settings.muted !== false },
    }));
  } catch (e) { /* private mode */ }
};

OW.loadDraft = function (save) {
  try {
    var raw = localStorage.getItem(OW.DRAFT_KEY);
    if (!raw) return null;
    return OW.craftFromJSON(raw, save);
  } catch (e) {
    return null;
  }
};

OW.writeDraft = function (craft) {
  try {
    localStorage.setItem(OW.DRAFT_KEY, OW.serializeCraft(craft));
  } catch (e) { /* ignore */ }
};
