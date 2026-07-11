// Generic Entity-Component-System engine. Zero game knowledge -- this file
// would drop into any other project unchanged.
//
// Entities are plain integer ids. Components are plain data objects (or, for
// tag components, any truthy value) stored one Map per component key.

export class World {
  constructor() {
    this._next = 1;
    this._stores = new Map(); // component key -> Map<entityId, data>
  }
  createEntity() {
    return this._next++;
  }
  add(entity, key, data) {
    let store = this._stores.get(key);
    if (!store) { store = new Map(); this._stores.set(key, store); }
    store.set(entity, data);
    return data;
  }
  get(entity, key) {
    const store = this._stores.get(key);
    return store ? store.get(entity) : undefined;
  }
  has(entity, key) {
    const store = this._stores.get(key);
    return store ? store.has(entity) : false;
  }
  remove(entity, key) {
    const store = this._stores.get(key);
    if (store) store.delete(entity);
  }
  destroyEntity(entity) {
    for (const store of this._stores.values()) store.delete(entity);
  }
  // Returns every entity id that has ALL of the given component keys.
  query(...keys) {
    if (!keys.length) return [];
    const [first, ...rest] = keys;
    const store0 = this._stores.get(first);
    if (!store0) return [];
    const restStores = rest.map(k => this._stores.get(k));
    const result = [];
    outer: for (const id of store0.keys()) {
      for (const s of restStores) {
        if (!s || !s.has(id)) continue outer;
      }
      result.push(id);
    }
    return result;
  }
}
