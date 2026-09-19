"""Run auction logic checks using macOS JavaScriptCore (no Node dependency)."""
import ctypes
import re
from pathlib import Path

js = ctypes.CDLL('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/JavaScriptCore')
ptr = ctypes.c_void_p
for name, args, result in [
    ('JSGlobalContextCreate', [ptr], ptr),
    ('JSStringCreateWithUTF8CString', [ctypes.c_char_p], ptr),
    ('JSCheckScriptSyntax', [ptr, ptr, ptr, ctypes.c_int, ctypes.POINTER(ptr)], ctypes.c_bool),
    ('JSEvaluateScript', [ptr, ptr, ptr, ptr, ctypes.c_int, ctypes.POINTER(ptr)], ptr),
    ('JSValueToStringCopy', [ptr, ptr, ctypes.POINTER(ptr)], ptr),
    ('JSStringGetMaximumUTF8CStringSize', [ptr], ctypes.c_size_t),
    ('JSStringGetUTF8CString', [ptr, ctypes.c_char_p, ctypes.c_size_t], ctypes.c_size_t),
]:
    fn = getattr(js, name)
    fn.argtypes, fn.restype = args, result
ctx = js.JSGlobalContextCreate(None)
script = (Path(__file__).resolve().parents[1] / 'scripts/auction.js').read_text()
def string(text):
    return js.JSStringCreateWithUTF8CString(text.encode())
def describe(value):
    text = js.JSValueToStringCopy(ctx, value, None)
    size = js.JSStringGetMaximumUTF8CStringSize(text)
    buf = ctypes.create_string_buffer(size)
    js.JSStringGetUTF8CString(text, buf, size)
    return buf.value.decode()
error = ptr()
assert js.JSCheckScriptSyntax(ctx, string(script), None, 1, ctypes.byref(error)), describe(error)
print('PASS: full inline script syntax')
functions = ['stablePlayerId', 'reconcilePlayerReferences', 'handleSold', 'handleUnsold', 'manualBidChange', 'updateTeamData', 'removePlayer', 'csvCell', 'parseCSV', 'driveThumbnail', 'escapeHTML', 'minSquadShortfallWarning', 'minimumPossibleBasePrice']
source = '\n'.join(re.search(r'function ' + name + r'\([^\n]*\) \{[\s\S]*?\n\}', script).group(0) for name in functions)
tests = r'''
let checks = 0;
function assert(ok, message) { if (!ok) throw new Error(message); checks++; }
let alerts = [], saves = 0;
const alert = message => alerts.push(message);
const activeConn = { send() {} };
const clearPlayerDirectorySelection = () => {};
const saveAndAction = () => saves++;
const renderEverything = () => {};
const sendBidOnly = () => {};
const fields = {pNameInput: {value: 'Alice', dataset: {playerId: '10'}}, pTypeInput: {value: 'Bowler'}, winSelect: {value: '0'}};
const document = {getElementById: id => fields[id]};
let sheetPlayers = [{id: 10, serial: 1, name: 'Alice'}];
let state = {teams: [{name:'Team', maxPurse:100, playerList:[]}], unsoldPlayers:[{sourceId:'10', name:'Alice'}], basePrice:10, currentBid:200, globalSeq:1};
handleSold();
assert(state.unsoldPlayers.length === 1 && state.teams[0].playerList.length === 0 && saves === 0, 'Rejected sale must be atomic');
state.currentBid = -50; handleSold();
assert(state.teams[0].playerList.length === 0, 'Negative sale rejected');
state.currentBid = 5; handleSold();
assert(state.teams[0].playerList.length === 0, 'Below-base sale rejected');
state.currentBid = 50; handleSold();
assert(state.unsoldPlayers.length === 0 && state.teams[0].playerList[0].price === 50, 'Valid sale transitions unsold to sold');
fields.pNameInput.value = 'Alice'; fields.pNameInput.dataset.playerId = '10'; fields.winSelect.value = '0'; handleSold();
assert(state.teams[0].playerList.length === 1, 'Duplicate sale rejected');
handleUnsold();
assert(state.teams[0].playerList.length === 1 && state.unsoldPlayers.length === 0, 'Unsold action cannot silently remove a sale');
manualBidChange(-1); assert(state.currentBid === 10, 'Negative manual bid rejected');
manualBidChange('1.5'); assert(state.currentBid === 10, 'Fractional bid rejected');
updateTeamData(0, 'maxPurse', '20'); assert(state.teams[0].maxPurse === 100, 'Purse cannot drop below spending');
const p = {name:'Alice', phone:'123', village:'Town', father:'Bob'};
assert(stablePlayerId(p) === stablePlayerId({...p, serial:99, role:'Batsman'}), 'Identity independent of row and role');
assert(stablePlayerId({...p, registrationId:'a'}) !== stablePlayerId({...p, registrationId:'b'}), 'Explicit IDs distinguish duplicate names');
state.playerIdentityVersion = 1;
sheetPlayers = [{id:10, serial:7, name:'Alice'}]; reconcilePlayerReferences();
assert(state.teams[0].playerList[0].sourceSerial === 7, 'Sheet reorder updates serial without losing sale');
delete state.playerIdentityVersion;
state.teams[0].playerList[0].sourceId = '0'; reconcilePlayerReferences();
assert(state.teams[0].playerList[0].sourceId === '10', 'Legacy row IDs migrate by unique name');
assert(parseCSV(['Name','A "quoted", name'].map(csvCell).join(','))[0][1] === 'A "quoted", name', 'CSV quote/comma roundtrip');
assert(csvCell('=1+1') === '"\'=1+1"', 'CSV formula neutralized');
assert(driveThumbnail('https://drive.google.com/file/d/abc_123/view').includes('/abc_123='), 'Template Drive photo link supported');
assert(escapeHTML('"<x>') === '&quot;&lt;x&gt;', 'Attribute escaping');

// Minimum squad size safeguard: warns (but does not silently block) a sale that would leave a team
// unable to afford its remaining required slots at base price, and only when the toggle is enabled.
let confirmed = null, confirmCalls = 0;
const confirm = message => { confirmCalls++; return confirmed; };
function freshWarriors() { return [{name:'Warriors', maxPurse:1000, playerList:[{price:100},{price:100},{price:100},{price:100},{price:100}]}]; }
function selectZara() { fields.pNameInput.value = 'Zara'; fields.pNameInput.dataset.playerId = '99'; fields.winSelect.value = '0'; }
sheetPlayers = [{id:99, serial:9, name:'Zara'}];
state.globalBasePrice = 40; state.basePriceMode = 'global'; state.basePrice = 40;
state.minSquadEnabled = false; state.minSquadSize = 15;
selectZara(); state.teams = freshWarriors(); state.currentBid = 200; confirmed = null; confirmCalls = 0;
handleSold();
assert(state.teams[0].playerList.length === 6 && confirmCalls === 0, 'Disabled squad limit never prompts or blocks, even with a real shortfall');
state.minSquadEnabled = true;
selectZara(); state.teams = freshWarriors(); state.currentBid = 200; confirmed = false; confirmCalls = 0;
handleSold();
assert(state.teams[0].playerList.length === 5 && confirmCalls === 1, 'Declining the shortfall warning leaves the sale unmade');
selectZara(); state.teams = freshWarriors(); state.currentBid = 200; confirmed = true; confirmCalls = 0;
handleSold();
assert(state.teams[0].playerList.length === 6 && confirmCalls === 1, 'Confirming the shortfall warning still completes the sale');
selectZara(); state.teams = freshWarriors(); state.currentBid = 100; confirmed = null; confirmCalls = 0;
handleSold();
assert(state.teams[0].playerList.length === 6 && confirmCalls === 0, 'A sale that leaves enough for the remaining squad never prompts');
assert(minimumPossibleBasePrice() === 40, 'Global mode uses the global base price as the safe floor');
state.basePriceMode = 'category'; state.categoryBasePrices = {A: 60, B: 20};
assert(minimumPossibleBasePrice() === 20, 'Category mode uses the cheapest configured category (or global) as the safe floor');
'PASS: ' + checks + ' auction regression checks';
'''
error = ptr()
result = js.JSEvaluateScript(ctx, string(source + tests), None, None, 1, ctypes.byref(error))
if error.value:
    raise AssertionError(describe(error))
print(describe(result))

connection_source = script[script.index('const overlayConnections = new Set();'):script.index("let overlayUrl = '';")]
connection_source += script[script.index("ctrlPeer.on('connection', conn => {"):script.index("ctrlPeer.on('error'")]
connection_test = r"""
let accept;
const ctrlPeer = {on(event, fn) { accept = fn; }};
const status = {style:{}};
const document = {getElementById() { return status; }};
const syncToDisplay = () => {};
const sendBidOnly = () => {};
""" + connection_source + r"""
function connection() {
    return {open:true, sent:0, events:{}, on(event, fn) {this.events[event]=fn;}, send() {this.sent++;}};
}
const first = connection(), second = connection();
accept(first); first.events.open(); accept(second); second.events.open();
activeConn.send({type:'TEST'});
if (first.sent !== 1 || second.sent !== 1) throw new Error('Both overlays must receive updates');
first.events.close(); activeConn.send({type:'TEST'});
if (second.sent !== 2 || overlayConnections.size !== 1) throw new Error('Closing older overlay must preserve newer connection');
second.send = () => {throw new Error('Disconnected');};
const console = {warn() {}};
activeConn.send({type:'TEST'});
return 'PASS: multi-overlay broadcast, independent close, and send failure isolation';
"""
error = ptr()
result = js.JSEvaluateScript(ctx, string('(function(){' + connection_test + '})()'), None, None, 1, ctypes.byref(error))
if error.value:
    raise AssertionError(describe(error))
print(describe(result))

mmm_source = (Path(__file__).resolve().parents[1] / 'themes/mmm.js').read_text()
mmm_tests = r'''
const nodes = {};
const document = {getElementById(id) {return nodes[id] || (nodes[id] = {dataset:{}, hidden:false, textContent:'', replaceChildren(){}, removeAttribute(){}, appendChild(){}});}, createElement(){return {appendChild(){}};}};
let expire;
const setTimeout = fn => {expire = fn; return 1;};
const clearTimeout = () => {};
function check(ok, message) {if(!ok) throw new Error(message);}
const player = {name:'Alice', role:'Bowler', village:'Town', panchayat:'District', phase:'intro', photo:'photo.jpg', photoAlignment:'bottom'};
receiveMMM({type:'SYNC_ALL',settings:{theme:'mmm',showBidding:true,teamVisibility:[]},currentPlayer:player,base:100,bid:100});
check(getPhotoAlignment({photoAlignment:'invalid'}) === 'top' && getPhotoAlignment({photoAlignment:'center'}) === 'center', 'Alignment normalization');
check(nodes['mmm-photo'].dataset.verticalAlign === 'bottom', 'Selected alignment reaches overlay');
check(nodes['display-app'].dataset.theme === 'mmm' && nodes['mmm-overlay'].dataset.phase === 'intro', 'Introduction and theme selection');
check(getMMMIntroFacts(player, {}, 100)[1].value === 'District', 'Panchayat metadata');
check(getMMMIntroFacts(player, {introFields:[]}, 100).length === 0, 'All introduction fields may be hidden');
const custom = getMMMIntroFacts({...player,introValues:{'column:age:1':'24'}}, {introFields:[{key:'column:age:1',label:'Age'},{key:'missing',label:'Missing'}]}, 100);
check(custom[0].label === 'Age' && custom[0].value === '24' && custom[1].value === '—', 'Custom sheet columns and missing values');
receiveMMM({type:'BID_UPDATE',player:{...player,phase:'bidding'},base:100,bid:200});
check(nodes['mmm-overlay'].dataset.phase === 'bidding', 'Bidding transition');
receiveMMM({type:'SOLD_CELEBRATION',playerDetails:player,team:'Team',bid:200});
receiveMMM({type:'SYNC_ALL',settings:{theme:'mmm',showBidding:true},currentPlayer:null,base:100,bid:100});
receiveMMM({type:'BACKGROUND_BID_UPDATE',base:100,bid:100});
check(nodes['mmm-overlay'].dataset.phase === 'sold' && !nodes['mmm-overlay'].hidden && nodes['mmm-caption-name'].textContent === 'ALICE', 'Result retains portrait after controller reset');
check(nodes['mmm-photo'].dataset.verticalAlign === 'bottom', 'Sold retains photo alignment');
expire(); check(nodes['mmm-overlay'].hidden, 'Result expires');
receiveMMM({type:'UNSOLD_ANIMATION',playerDetails:player});
check(nodes['mmm-overlay'].dataset.phase === 'unsold', 'Unsold transition');
receiveMMM({type:'SYNC_ALL',settings:{theme:'mmm',showBidding:false},currentPlayer:null});
check(nodes['mmm-overlay'].hidden, 'Visibility toggle applies to results');
receiveMMM({type:'RESET_VIEW'}); check(!mmmDisplay.result, 'Reset clears result');
receiveMMM({type:'SYNC_ALL',settings:{theme:'classic',showBidding:true},currentPlayer:player});
check(nodes['display-app'].dataset.theme === 'classic', 'Classic theme restoration');
nodes['mmm-photo'].onerror(); check(nodes['mmm-photo'].hidden, 'Broken photo falls back to initials');
return 'PASS: MMM theme states, result lifecycle, metadata, visibility, switching, and photo fallback';
'''
error = ptr()
result = js.JSEvaluateScript(ctx, string('(function(){' + mmm_source + mmm_tests + '})()'), None, None, 1, ctypes.byref(error))
if error.value:
    raise AssertionError(describe(error))
print(describe(result))

tournament_source = (Path(__file__).resolve().parents[1] / 'scripts/tournaments.js').read_text()
tournament_tests = r'''
const items = new Map();
const localStorage = { getItem:key => items.get(key) ?? null, setItem:(key,value) => items.set(key,String(value)), removeItem:key => items.delete(key), key:index => [...items.keys()][index], get length(){return items.size;} };
let nextId = 0;
const crypto = {randomUUID:() => 'test-' + (++nextId)};
function check(ok,message) {if(!ok) throw new Error(message);}
const original = JSON.stringify({teams:[{name:'Legacy',playerList:[{name:'Alice',price:100}]}],settings:{theme:'mmm'}});
localStorage.setItem('auc_state_v8',original);
localStorage.setItem('auc_player_sheet_url_v1','legacy-sheet');
check(migrateLegacyTournament().length === 1, 'Legacy auction imported');
check(migrateLegacyTournament().length === 1, 'Migration is idempotent');
check(localStorage.getItem('auc_state_v8') === original, 'Original legacy data retained');
check(localStorage.getItem(tournamentStorageKey('legacy','state')) === original, 'Legacy state preserved exactly');
check(localStorage.getItem(tournamentStorageKey('legacy','sheet')) === 'legacy-sheet', 'Legacy sheet retained');
const a = createTournamentRecord('First'), b = createTournamentRecord('Second');
const overlay = tournamentPeerId(a.id, 'overlay'), overview = tournamentPeerId(a.id, 'overview');
check(tournamentPeerId(a.id,'overlay') === overlay, 'Overlay identity remains stable');
check(tournamentPeerId(a.id,'overview') === overview, 'Overview identity remains stable');
check(overlay !== overview && tournamentPeerId(b.id,'overlay') !== overlay, 'Roles and tournaments have distinct IDs');
for (const part of ['state','sheet','tab','players']) {
 localStorage.setItem(tournamentStorageKey(a.id,part), 'A-'+part);
 localStorage.setItem(tournamentStorageKey(b.id,part), 'B-'+part);
 check(localStorage.getItem(tournamentStorageKey(a.id,part)) === 'A-'+part,'Tournament storage isolation: '+part);
}
localStorage.setItem(tournamentStorageKey(a.id,'state'),'reset');
check(localStorage.getItem(tournamentStorageKey(b.id,'state')) === 'B-state', 'Reset does not affect another tournament');
check(tournamentPeerId(a.id,'overlay') === overlay && tournamentPeerId(a.id,'overview') === overview, 'Auction reset preserves links');
check(readTournamentIndex().length === 3, 'Both new tournaments remain in index');
let failed = false; try {createTournamentRecord('  ');} catch (_) {failed = true;}
check(failed && readTournamentIndex().length === 3, 'Invalid name does not create a tournament');
deleteTournamentRecord(a.id);
check(!readTournamentIndex().some(t => t.id === a.id), 'Deleted tournament removed from index');
check(![...items.keys()].some(key => key.startsWith(tournamentStorageKey(a.id,''))), 'Deleted tournament storage and permanent links removed');
check(localStorage.getItem(tournamentStorageKey(b.id,'state')) === 'B-state', 'Other tournament survives deletion');
deleteTournamentRecord('legacy');
check(!localStorage.getItem('auc_state_v8'), 'Legacy source removed after explicit deletion');
check(migrateLegacyTournament().length === 1, 'Deleted legacy tournament does not reappear');
return 'PASS: migration, isolation, permanent links, tournament deletion and legacy deletion';
'''
error = ptr()
result = js.JSEvaluateScript(ctx, string('(function(){' + tournament_source + tournament_tests + '})()'), None, None, 1, ctypes.byref(error))
if error.value:
    raise AssertionError(describe(error))
print(describe(result))

# Overview rendering and checkbox selection must agree for initial sync and bid updates.
overview_source = '\n'.join(re.search(r'function ' + name + r'\([^\n]*\) \{[\s\S]*?\n\}', script).group(0) for name in [
    'switchOvTab', 'buildSoldLookup', 'handleOvLiveSync', 'handleOvLiveBid', 'armOvLiveResultTimer',
    'renderLiveAuctionPane', 'renderOvLivePhotoHtml', 'renderOvLiveStageHtml', 'renderOvLiveResultHtml',
    'escapeHTML', 'playerAge'
])
mmm_source = (Path(__file__).resolve().parents[1] / 'themes/mmm.js').read_text()
overview_source += '\n' + mmm_source[:mmm_source.index('function renderMMM()')]
overview_tests = r'''
const nodes = {};
const document = {getElementById(id) { return nodes[id] ||= {style:{}, innerHTML:'', replaceChildren(){this.innerHTML='';}, classList:{toggle(_, value){this.active=value;}}}; }};
let ovData = {introFields:[{key:'village',label:'Village'}]};
let ovLiveLastPlayer = null, ovLiveResult = null, ovLiveResultTimer = null;
let expire;
const setTimeout = fn => {expire = fn; return 1;};
const clearTimeout = () => {};
function check(ok, message) {if (!ok) throw new Error(message);}
const player = {name:'A <B>',photo:'player.jpg',role:'Batsman',serial:7,introValues:{village:'Town',secret:'Hidden'}};

handleOvLiveSync({type:'OVERVIEW_SYNC', introFields:[{key:'village',label:'Village'}, {key:'basePrice',label:'Base price'}], teams:[], allPlayers:[], soldSerials:[], unsoldSerials:[], currentPlayer:player, base:100, bid:200});
const pane = nodes['ov-live-pane'];
check(pane.innerHTML.includes('player.jpg') && pane.innerHTML.includes('A &lt;B&gt;'), 'Photo and escaped player name');
check(pane.innerHTML.includes('Town') && pane.innerHTML.includes('Base price') && !pane.innerHTML.includes('Hidden'), 'Only selected metadata shown');

handleOvLiveBid({type:'OVERVIEW_BID', introFields:[], player, base:100, bid:300});
check(pane.innerHTML.includes('300'), 'Bid-only update changes card without a full resync');

switchOvTab('teams');
check(nodes['ov-teams-pane'].classList.active && !nodes['ov-players-pane'].classList.active && !nodes['ov-live-pane'].classList.active, 'Overview tab selection');

handleOvLiveSync({type:'OVERVIEW_SYNC', introFields:[], teams:[{name:'Titans', playerList:[{name:'A <B>', price:500, sourceSerial:7}]}], allPlayers:[], soldSerials:[7], unsoldSerials:[], currentPlayer:null, base:0, bid:0});
check(pane.innerHTML.includes('SOLD') && pane.innerHTML.includes('Titans') && pane.innerHTML.includes('500'), 'Sold reveal shows winning team and price');
expire();
check(pane.innerHTML.includes('No player is currently up for auction'), 'Sold reveal clears back to empty state after its timer');

handleOvLiveSync({type:'OVERVIEW_SYNC', introFields:[], teams:[], allPlayers:[], soldSerials:[], unsoldSerials:[], currentPlayer:{name:'Bob',serial:9}, base:50, bid:0});
handleOvLiveSync({type:'OVERVIEW_SYNC', introFields:[], teams:[], allPlayers:[], soldSerials:[], unsoldSerials:[9], currentPlayer:null, base:0, bid:0});
check(pane.innerHTML.includes('UNSOLD') && pane.innerHTML.includes('Bob'), 'Unsold reveal shows the player who went unsold');

check(playerAge('2005-12-31',2026) === '21' && playerAge('31/12/2005',2026) === '21', 'DOB uses calendar year');
check(playerAge('20',2026) === '20' && playerAge('',2026) === '', 'Explicit and missing age');
check(playerAge('2025-02-29',2026) === '' && playerAge('2028-01-01',2026) === '', 'Invalid and future DOB');
return 'PASS: overview details, selected fields, tabs, bids, sold/unsold reveal and DOB ages';
'''
error = ptr()
result = js.JSEvaluateScript(ctx, string('(function(){' + overview_source + overview_tests + '})()'), None, None, 1, ctypes.byref(error))
if error.value:
    raise AssertionError(describe(error))
print(describe(result))

# Exercise the real import mapping with the downloadable template's headers.
import_mapping = script[script.index('        const headerLabels = rows.shift()'):script.index('        if (!readTournamentIndex().some', script.index('async function loadSheetPlayers'))]
import_helpers = '\n'.join(re.search(r'function ' + name + r'\([^\n]*\) \{[\s\S]*?\n\}', script).group(0) for name in ['playerAge', 'normaliseRole', 'driveThumbnail', 'stablePlayerId'])
import_test = r"""
const state = {};
const rows = [['ID','Name','Photo','Village/Locality','City','Age/DOB','Icon type / role','Player category'], ['P001','Alice','','Locality','City','2005-12-31','Bowler','Senior']];
""" + import_mapping + r"""
const p = importedPlayers[0];
if (p.registrationId !== 'P001' || p.village !== 'Locality' || p.city !== 'City' || p.category !== 'Senior' || p.role !== 'Bowler') throw new Error('Template import fields');
if (p.age !== String(new Date().getFullYear()-2005)) throw new Error('Imported age');
const ageField = state.sheetColumns.find(f => f.label === 'Age');
if (!ageField || p.sheetValues[ageField.key] !== p.age) throw new Error('Checkbox age metadata');
return 'PASS: new CSV template import mapping and calculated age metadata';
"""
error = ptr()
result = js.JSEvaluateScript(ctx, string('(function(){' + import_helpers + import_test + '})()'), None, None, 1, ctypes.byref(error))
if error.value:
    raise AssertionError(describe(error))
print(describe(result))

directory_source = '\n'.join(re.search(r'function ' + name + r'\([^\n]*\) \{[\s\S]*?\n\}', script).group(0) for name in ['directoryPlayerVisible', 'buildPlayerDirectoryOptions', 'resolveDirectoryPlayer', 'formatPlayerDirectoryLabel', 'escapeHTML'])
directory_tests = r'''
const nodes = {showUnsoldDirectoryPlayers:{checked:false}, playerDirectorySelect:{value:''}, playerDirectoryOptions:{innerHTML:''}};
const document = {getElementById:id=>nodes[id]};
const sheetPlayers = [{id:1,serial:1,name:'Available'}, {id:2,serial:2,name:'Unsold'}];
const getPlayerStatusById = id => id === 2 ? 'unsold' : 'available';
for (const enabled of [false,true,false]) {
 nodes.showUnsoldDirectoryPlayers.checked = enabled;
 buildPlayerDirectoryOptions();
 if (nodes.playerDirectoryOptions.innerHTML.includes('Unsold') !== enabled) throw new Error('Unsold suggestion visibility');
 if (Boolean(resolveDirectoryPlayer('SL 02')) !== enabled || Boolean(resolveDirectoryPlayer('Unsold')) !== enabled) throw new Error('Unsold selection by serial or name');
 if (!resolveDirectoryPlayer('Available')) throw new Error('Available players remain selectable');
}
return 'PASS: unsold switch filters suggestions and selection by serial/name';
'''
error = ptr()
result = js.JSEvaluateScript(ctx, string('(function(){' + directory_source + directory_tests + '})()'), None, None, 1, ctypes.byref(error))
if error.value:
    raise AssertionError(describe(error))
print(describe(result))

pricing_source = '\n'.join(re.search(r'function ' + name + r'\([^\n]*\) \{[\s\S]*?\n\}', script).group(0) for name in ['basePriceFor', 'applyPlayerBasePrice', 'refreshActiveBasePrice', 'bidStepFor', 'validBidRanges', 'changeBid'])
pricing_tests = r'''
let state = {basePrice:100, currentBid:100, bidIncrement:10, basePriceMode:'category', categoryBasePrices:{Senior:500, Junior:0}, bidRanges:[{from:0,to:1000,increment:100},{from:1000,to:2000,increment:200}]};
const sheetPlayers = [{id:1, category:'Senior'}];
const saveAndAction = () => {};
const sendBidOnly = () => {};
const alert = message => {throw new Error(message);};
function check(value,message) {if (!value) throw new Error(message);}
applyPlayerBasePrice(sheetPlayers[0]);
check(state.basePrice === 500 && state.currentBid === 500 && state.globalBasePrice === 100, 'Category price and separate global default');
check(basePriceFor({category:'Junior'}) === 0 && basePriceFor({category:'Missing'}) === 100, 'Zero and missing category prices');
state.currentPlayer = {id:1,phase:'bidding'}; state.currentBid = 700;
state.categoryBasePrices.Senior = 600; refreshActiveBasePrice();
check(state.currentBid === 700 && state.basePrice === 600, 'Preserve live bid on configuration update');
check(bidStepFor(999) === 100 && bidStepFor(1000) === 200 && bidStepFor(2000) === 10, 'Range boundaries and default fallback');
state.currentBid = 1000; changeBid(1);
check(state.currentBid === 1200, 'Bid button uses configured range');
check(validBidRanges(state.bidRanges), 'Adjacent ranges allowed');
check(!validBidRanges([{from:0,to:1000,increment:100},{from:900,to:null,increment:200}]), 'Overlaps rejected');
check(!validBidRanges([{from:0,to:null,increment:0}]), 'Zero increments rejected');
check(validBidRanges([{from:0,to:null,increment:100}]), 'Open-ended range allowed');
state.basePriceMode = 'global'; applyPlayerBasePrice(sheetPlayers[0]);
check(state.basePrice === 100 && state.currentBid === 100, 'Global mode restores global price');
return 'PASS: category pricing, fallback, active bids, increment ranges and validation';
'''
error = ptr()
result = js.JSEvaluateScript(ctx, string('(function(){' + pricing_source + pricing_tests + '})()'), None, None, 1, ctypes.byref(error))
if error.value:
    raise AssertionError(describe(error))
print(describe(result))
