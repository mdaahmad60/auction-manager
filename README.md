# Cloudflare deployment

For GitHub + Cloudflare hosting/live overview + Supabase, follow [the deployment guide](docs/CLOUDFLARE_DEPLOYMENT.md). The existing Vercel instructions below remain for legacy deployment.

# Auction System

A tournament auction controller with Supabase account creation, email confirmation, login, password recovery, and private cloud storage. Vercel hosts the frontend; Supabase provides authentication and the database.

See [Deployment setup](docs/DEPLOYMENT.md) to create your new Supabase, GitHub, and Vercel projects.

## Run with accounts

Install Node 22, copy `.env.example` to `.env.local`, set your public Supabase configuration, and apply the database migration described in the deployment guide. Then run:

```sh
npm install
npm run dev
```

Open `http://localhost:3000`. Cloud saves are automatic, with a visible save status and recovery backup download. Use one active controller per account; concurrent stale saves are blocked and offer a reload.

## Standalone local preview

The source `config.js` enables the original browser-only mode for local previews. Production builds always require Supabase configuration and disable this mode.


Serve this directory using a static web server, for example:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. For viewers on other devices, host the app at an address those devices can reach. Same-origin tabs in the same browser connect directly without internet. Separate browsers/OBS use PeerJS signaling and may need internet access; Google Sheets import also needs internet. Copy the overlay or overview URL from the controller; leave the controller open throughout the auction. Multiple overlay connections are supported. Overlay and overview URLs stay the same for each tournament across controller refreshes.

## Tournaments

The app opens on **Your tournaments**. Choose **Add tournament**, enter a name, and create it to open the auction controller. **All tournaments** returns to the home screen; select a card to reopen an auction.

Each tournament keeps separate teams, purses, sales, unsold players, imported player directory, sheet URL, bid increment, display settings, and last-used tab. New tournaments start without a sheet; add its link in Player Directory and click Refresh. The imported directory is cached so reopening does not require another sheet fetch. Use Refresh when you want updated registrations.

The previous single auction is automatically copied into **Existing tournament**, with its original storage retained as a recovery copy. **Reset this auction** affects only the open tournament. In account mode, data belongs to the signed-in account and is saved to Supabase. In standalone mode it remains local to this browser and origin. Keep the controller open during a live event; reopening it reuses the tournament’s saved overlay and overview links.

## Player import

Download the sheet template from the app. The template columns are `ID`, `Name`, `Photo`, `Village/Locality`, `City`, `Age/DOB`, `Icon type / role`, and `Player category`. Enter an age or DOB as `YYYY-MM-DD` or `DD/MM/YYYY`; DOB is converted to current year minus birth year when refreshing the sheet. Selected Age/DOB information displays the calculated age. Give each player a unique, permanent `ID` (legacy `player id` and `registration id` columns are also accepted). Keep IDs unchanged when updating registrations. Without explicit IDs, identity is derived from name, phone, village, and father name; editing those fields changes identity. Duplicate identities are rejected without replacing the loaded directory.

Old auctions using row numbers migrate by unique player name on import. Ambiguous matches remain unlinked for manual review. Refreshing the sheet clears the currently selected player so an outdated selection cannot be sold accidentally.

## Auction safeguards

Bids must be non-negative whole amounts; sales must meet the base price and fit the remaining purse. Duplicate sales and unsold entries are rejected. A rejected sale leaves the auction records unchanged. Remove a sold player from its team to return it to the unsold list. Purses cannot be reduced below existing spending.

Export CSV before leaving an event. CSV is a results report, not a restorable backup. Browser storage failures produce a warning. Unreadable saved auction data triggers an attempt to preserve the original text under that tournament’s state key with a `_recovery` suffix in local storage before initialization.

## Regression checks

On macOS, run the dependency-free JavaScriptCore checks:

```sh
python3 tests/auction_regression.py
```

Run `npm test` for authentication, persistence, and deployment configuration checks.

The Python checks verify application JavaScript syntax and auction logic with mocked UI elements. They do not exercise browser rendering or live PeerJS connections.

## MMM Purple overlay theme

Under **Display Overlay Controls**, choose **MMM Purple**. The selection is saved with the auction and sent to connected overlays; choose **Classic** to restore the original design.

- Selecting a player shows the introduction card, including village, optional `panchayat` sheet column, and base price.
- Changing the bid with the +/− controls or manual bid field automatically shows the centered bidding graphic. No separate start action is needed.
- Sold and unsold results retain the player's portrait for seven seconds, then clear. Selecting the next player or resetting the display clears the previous result.
- The team logo appears on the left of the sold graphic; an animated auction hammer appears on the right. Missing photos and logos use initials; missing location fields display a dash.
- The production overlay remains transparent at 1920 × 1080. Team details take priority when enabled; the balance sheet is hidden while the MMM player graphic is visible.

Open `tests/theme-preview.html` for an interactive, disconnected preview of all four layouts using sample data. Its green background is only a preview backdrop.

MMM Purple uses smooth portrait/layout transitions, a repeating shimmer, bid-change pulses, and three hammer strikes with impact rings on sold. These effects respect the browser/system reduced-motion preference.


## Localhost connection troubleshooting

Keep the controller open and copy its current overlay link from **Link & control**. Use exactly the same origin (scheme, hostname, and port) in another tab of the same browser: `localhost` and `127.0.0.1` are different origins. Local tabs use BroadcastChannel, with connection heartbeats and automatic reconnection/resync. PeerJS 1.5.2 is bundled locally so loading the app no longer depends on the CDN.

OBS and different browsers use WebRTC/PeerJS with automatic signaling and data-connection retries. This path still depends on signaling/STUN/TURN availability and network policy. A localhost URL refers to the device opening it: for another computer or phone, serve the app on a reachable LAN address and open the controller using that address before copying the link. Reloading the controller keeps its links unchanged; existing viewers reconnect automatically when it returns. Use one active controller per tournament. These URLs remain stable on the same host/path while the tournament’s browser storage is retained. Links copied before permanent tournament links were introduced must be replaced once.

Serve the project and visit `tests/connection-browser.html` to test direct local connections without loading PeerJS, including delivery, disconnect, reconnect, and resync.

## Choose introduction information

In **Link & control → Initial player overlay information**, select the fields shown in the MMM Purple introduction. Refresh the player sheet first to discover all column names, including custom columns. Village, panchayat, and the auction base price are selected by default. You can deselect any of them or select additional columns; selections are saved with auction settings and sync immediately to connected overlays.

The player name, photo, and role remain in the header. Selected details use the sheet's values, with a dash for missing data, and wrap into additional rows as needed. Details appear in selection order. Base price comes from the auction's configured base price. The bidding, sold, and unsold layouts remain unchanged.

`tests/tournaments-browser.html` checks migration, creation, reopening, storage separation, and checkbox dimensions in a clean browser profile. It skips if that profile already contains local storage, protecting existing auctions.

## Delete a tournament

Choose **Delete** on its home-screen card and confirm the tournament name. This removes that tournament’s saved auction, cached players, sheet link, preferences, recovery data, and permanent connection IDs from this browser. Other tournaments are unaffected. Deleting **Existing tournament** also removes its original legacy recovery keys so it will not be imported again. Controllers open for the deleted tournament in another tab disconnect and return home. Deletion cannot be undone.

## Overlay photo alignment

At the bottom of **Auction**, use **Top aligned**, **Center aligned**, or **Bottom aligned** for the selected player. Both overlay themes fit the photo to the frame width at its original aspect ratio; only the vertical position changes. Tall images are clipped, while short images leave empty frame space. Alignment updates live, is saved per sheet player within the tournament, and stays with the MMM sold/unsold portrait. The default is top alignment.

## Mobile controller layout

The controller adapts to phones and tablets with a sticky, horizontally scrollable tab bar, stacked setup fields, larger touch targets, and tables that scroll within their panels. Player listings use normal page scrolling on phones. Form labels, focus indicators, and checkbox rows are sized for easier use; auction behavior and broadcast layouts are unchanged.

`tests/mobile-controller-browser.html` checks all controller tabs at 320, 390, 768, and 1280 pixels for page overflow and minimum button height. Run it in a clean browser profile.

### Base prices and bid increments

Tournament Setup supports Global or Based on category base prices. Categories come from the loaded player sheet; blank category prices and uncategorized players use the global price. Selecting a player starts their bid at the applicable base price. Configure optional From / To / Increment ranges below the base-price controls. From is inclusive and To is exclusive; blank To means unlimited. Ranges cannot overlap. Outside configured ranges, the default increment is used. The auction counter shows the active base price and increment. Settings are saved per tournament.
