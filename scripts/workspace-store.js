/* Versioned cloud persistence behind the same synchronous API as browser storage. */
class WorkspaceStore {
    constructor({values = {}, revision = 0, save, cache, report = () => {}}) {
        this.values = {...values}; this.revision = revision;
        this.save = save; this.cache = cache; this.report = report;
        this.dirty = false; this.conflict = false; this.saving = null; this.timer = null;
    }
    get length() { return Object.keys(this.values).length; }
    key(index) { return Object.keys(this.values)[index] ?? null; }
    getItem(key) { return Object.hasOwn(this.values,key) ? this.values[key] : null; }
    setItem(key,value) {
        if (!key.startsWith('auc_')) throw new Error('Invalid auction storage key');
        value = String(value);
        if (this.values[key] === value) return;
        this.values[key] = value; this.changed();
    }
    removeItem(key) { if (Object.hasOwn(this.values,key)) { delete this.values[key]; this.changed(); } }
    changed() {
        this.dirty = true; this.cacheSnapshot();
        this.report(this.conflict ? 'conflict' : 'pending');
        clearTimeout(this.timer);
        if (!this.conflict) this.timer = setTimeout(() => this.flush().catch(() => {}), 400);
    }
    cacheSnapshot() {
        try { this.cache({values:this.values,revision:this.revision,pending:this.dirty}); }
        catch (_) { this.report('cache-error'); }
    }
    async flush() {
        clearTimeout(this.timer);
        if (this.conflict) throw new Error('Another device saved changes. Download your pending copy, then reload.');
        if (this.saving) { await this.saving; return this.flush(); }
        if (!this.dirty) return;
        this.saving = this.persist();
        try { await this.saving; } finally { this.saving = null; }
        if (this.dirty) return this.flush();
    }
    async persist() {
        const snapshot = {...this.values};
        this.report('saving');
        try {
            const next = await this.save(this.revision,snapshot);
            this.revision = Number(next);
            this.dirty = JSON.stringify(snapshot) !== JSON.stringify(this.values);
            this.cacheSnapshot();
            this.report(this.dirty ? 'pending' : 'saved');
        } catch (error) {
            this.dirty = true;
            this.conflict = error.code === '40001';
            this.cacheSnapshot(); this.report(this.conflict ? 'conflict' : 'error',error);
            throw error;
        }
    }
}
if (typeof module !== 'undefined') module.exports = {WorkspaceStore};
