# 11 Timaru landmarks: Stafford Street shops, malls, the Old Mill, Pātītī Point, South Beach, curve chevrons

Status: COMPLETE for this pass. Written 2026-11-20.

Note on the file number: numbered 11 because 08 and 10 were already taken.

Method and limits
- Every fact here comes from a page or PDF read in this session, or is marked **(unverified)** or "inference". Nothing is from memory.
- Three kinds of evidence are kept apart: "page" (text read directly), "catalogue" (South Canterbury Museum PastPerfect record or DigitalNZ metadata, read directly), and "OSM" (present-day OpenStreetMap geometry and address points, used only to measure distances; see the caveat below).
- I could not look at the photographs themselves this session (images can only be viewed inside the repo, and I was told to create no other files). Anything about how a photo *looks* comes from the catalogue text or from the earlier viewing recorded in `02-street-photographs.md`.
- Blocked this session: Bing, DuckDuckGo, Mojeek, Google and (after a few queries) Brave search; Papers Past (Incapsula); timaru.govt.nz (Cloudflare 403; council PDFs were read from Wayback copies instead); NZTA website (Incapsula; MOTSAM read from Wayback); Stuff (JS shell; two articles read from Wayback); Te Ara (wrong URL, then not retried).
- OSM caveat: street geometry and address points are 2026 data. Street layout and building numbers in central Timaru are old (the heritage reports use the same numbers for 1870s to 1920s buildings), so the distances should hold for 1995 to within about ±15 m. Shop occupants in OSM were not used.
- Raw downloads are in /private/tmp/the03-research/fetch08/ (helper scripts: get.sh, dnz2.sh, brave.sh, chain.py, nom2.py).

---

## 0. Stafford Street skeleton (use this for the map)

### 0a. Orientation and side convention

- Stafford Street runs NW to SE (game "north to south") from the Bay Hill to George Street in the heritage area, then on south. Source: Timaru District Council (TDC) Historic Heritage Area report HHA1, Wayback copy of https://www.timaru.govt.nz/__data/assets/pdf_file/0006/674034/Historic-Heritage-Historic-Heritage-Area-Assessment-Report-HHA1-Stafford-Street-Historic-Heritage-Area.pdf : "extends on a north-west to south-east axis between the Bay Hill in the north and George Street in the south. Canon, Church, Strathallan and Beswick Streets intersect with Stafford Street within the area; the elevation of the street increases towards the north."
- Look of the street, from the same report: "Buildings are typically two storeys in height, with decorative commercial classical facades and modern shopfronts. Verandas are typically suspended from the building facades." Materials: "Timaru bluestone, brick and cement plaster".
- Odd numbers are on the north-east (seaward, railway, port) side; even numbers on the south-west (inland, Sophia Street) side; numbers rise towards the north. Evidence: the report names Hay's Buildings 229-237, Stafford Chambers 199-209 and Orari Buildings 327-341 as "on the north-east side"; TDC record HHI49 puts Coronation Buildings 256-260 "on the south-west side"; and every OSM address point checked (20 numbers) fell on the side this rule predicts.
- SH1 still ran along Stafford Street in this era (see `07-verification-and-ngai-tahu.md` item 8f). HHA1 also says: "In the late 20th century, when the final stage of re-routing SH 1 away from Stafford Street to the new by-pass to the west of Timaru's downtown was imminent..."

### 0b. Church Street and Stafford Street

CONFIRMED: there is a Church Street / Stafford Street intersection. It is a four-way crossroads where Church Street comes in from the west (inland) and Strathallan Street from the east (towards the railway and port).
- OSM: Church Street and Strathallan Street share a node with Stafford Street at -44.39540, 171.25255, 368 m south of the Bay Hill end.
- TDC record HHI48 (Old Bank Hotel), Wayback copy of https://www.timaru.govt.nz/__data/assets/pdf_file/0005/673871/Historic-Heritage-Assessment-Report-HHI48-Old-Bank-Hotel-Category-B.pdf : "The building occupies a corner site on the western side of Stafford Street, bounded by Church Street to the south-east. The former Hays building (heritage item # 29) is across Stafford Street."
- Already in our notes: the 12 August 1995 VJ+50 crowd photo is captioned "corner Stafford and Strathallan (sign reads Church St)" (`02-street-photographs.md` T4).

The four corners in 1995:
- North-west corner: Old Bank Hotel, 232 Stafford St. Two storeys, chamfered corner, a clock over the corner, brick and cement plaster. HHI48: "Two storey-building with a rectangular footprint and hipped roof. North-east and south-east elevations address the roadway and meet at a chamfered corner... Clock mounted at corner above former entry." Also "Modern signage (pre-1993)". The 1995 VJ parade photo shows a "Speight's Southern Man" banner along its frontage (`02` T5).
- North-east corner: former Hay's Buildings / CML building, 229-237 Stafford St. THREE storeys, curved corner front. TDC record HHI45, Wayback copy of https://www.timaru.govt.nz/__data/assets/pdf_file/0011/673868/Historic-Heritage-Assessment-Report-HHI45-Former-Hay-s-Buildings-Category-A.pdf : "Three storey-building with segmental footprint... Central entry at street corner has open-bed swan-neck pediment... Modern shopfronts with suspended veranda, solid parapet with dentiled cornice." "It has been occupied in the past by the Colonial Mutual Life Assurance company, and the Trustbank and Westpac banks". The 1995 VJ photo shows a Westpac branch with the red "W" cube sign (`02` T5); inference that this was the Hay's corner branch.
- South-east corner: a pocket park with the Bob Fitzsimmons statue. HHI45: "On the opposite side of Strathallan Street is a pocket park in which is located a statue of Timaru boxer Bob Fitzsimmons." The statue was there by 1995. Catalogue (keyword search https://timdc.pastperfectonline.com/search?search_criteria=%22Bob%20Fitzsimmons%20statue%22 ): "The statue of Bob Fitzsimmons prior to being erected on the corner of Stafford and Strathallan Street, Timaru, circa 1991."; "David Tua posed in front of the Bob Fitzsimmons statue on Stafford Street, Timaru, dated 3 September 1992."
- South-west corner: **(unverified)**.
- Traffic lights: the 1995 crowd photo at this corner shows yellow signal housings on plain poles (`02` T4).

### 0c. Order along Stafford Street, north to south

Distances are metres south of the Bay Hill / Port Loop Road end, measured along the OSM centreline. Building positions come from OSM address points projected onto the centreline (±15 m). "E" = north-east / seaward side, "W" = south-west / inland side.

| m from north end | Side | What | 1995 status | Source |
|---|---|---|---|---|
| 0 | | North end: The Bay Hill and Port Loop Road (Sefton Street meets here too) | street | OSM; `02` T20 "Stafford Street / Sefton Street / Port Loop Road intersection" |
| ~33 | W | Dominion Hotel, 334-336 | heritage building (trading in 1995 **unverified**) | HHA1 Fig. 18: "Dominion Hotel [former Melville Hotel], 334-336 Stafford Street" |
| 127 | W | Canon Street. Ballantynes on the Stafford/Canon corner (new store 1986) | Ballantynes there | HHA1: "Ballantynes department store opened new premises in 1986 on the site, at the corner of Stafford and Canon Streets" |
| ~204 | W | O'Meeghan's Buildings, 284-286 (1911-12) | building | HHA1 Fig. 17 |
| ~245-269 | E | Tekapo Buildings, 255-265 (1925) | building | HHA1 Fig. 39 |
| ~262-273 | W | **Farmers**, Coronation Buildings 256-260, plus the c.1910 building immediately north | Farmers trading | Section 2 |
| ~283 | E | **Stafford Mall**, 251 | trading | Section 3 |
| ~334-352 | E | Former Hay's Buildings / CML building, 229-237, 3 storeys, curved corner | building | 0b |
| ~354 | W | Old Bank Hotel, 232 | hotel | 0b |
| 368 | | **Church St (W) / Strathallan St (E) crossroads**; Fitzsimmons statue SE corner | | 0b |
| ~416 | W | Rhodes's Buildings, 218-226 (1892) | building | HHA1 Fig. 13 |
| 431 | E | Beswick Street | | OSM |
| ~451-467 | E | Stafford Chambers, 199-209, south corner of Beswick St | building | HHA1 Fig. 12 "199-209 Stafford Street / 18-22 Beswick Street" |
| ~471-477 | W | **Royal Arcade** entrance, 196-200, through to Sophia St | being restored, reopened 31 May 1996 | Section 6 |
| 632 | | George Street (south end of the heritage area) | | OSM, HHA1 |
| 834 | | Woollcombe Street | | OSM |
| 1038 | | North Street. The **Old Mill** is about 100 m east down North St, south side | nightclub | Section 8 |
| 1159 | | Heaton Street | | OSM |
| 1232 | | King Street (south end of Stafford St) | | OSM |

Not placed: Theatre Royal, 118 Stafford St (in `07`). Nominatim had no house-level point for 118, so its position on this list is **(unverified)**.

Block lengths for the map: Bay Hill to Canon about 127 m; Canon to Church/Strathallan about 241 m; Church/Strathallan to Beswick about 63 m; Beswick to George about 200 m.

---

## 1. DEKA, Stafford Street

Verdict: chain facts CONFIRMED. A Timaru DEKA on Stafford Street about 1990 CONFIRMED by catalogue. Address, block and building **(unverified)**. Sign colour yellow (earlier viewing). D·E·K·A lettering **(unverified)**.

- The chain: https://en.wikipedia.org/wiki/DEKA_(New_Zealand) : "DEKA was a nationwide chain of general merchandise stores in New Zealand. It was launched in 1988 by L.D. Nathan"; "In 1988 L.D Nathan rebranded their General Merchandise business (MaxiMart, Big City, Mark II ) to DEKA, which launched with 90 stores"; "The launch was supported with a large advertising campaign of print and TV advertising with the 'I Feel Good' slogan, using the James Brown I Got You song. DEKA used the 'I Feel Good' slogan until 1996."; "DEKA joined with Farmers Trading Company in 1992 to create Farmers Deka Limited."; "On 30 July 2001, the DEKA brand ceased to operate in New Zealand... Seventeen stores were converted to Farmers stores and the remaining 43 were closed." Earlier history: https://en.wikipedia.org/wiki/Woolworths_(New_Zealand) : "L.D. Nathan acquired 70 McKenzies general merchandise stores in 1980, rebranding the stores as Woolworths. The general merchandise stores were rebranded as DEKA in 1988."
  - For 1995: the "I Feel Good" jingle is right; "You Know Where" (1996) is not.
- The Timaru store: three museum photos carry the search term "DEKA, Timaru", all taken on Stafford Street looking NORTH from outside or near Faulks & Jordan Chemists:
  - https://timdc.pastperfectonline.com/photo/C1F496CC-9E04-4555-8FD7-107380031070 (dated 1990): "Stafford Street, Timaru, 1990, as viewed from near Faulks & Jordan Chemnists." Search terms: "Galvin's Bargains Galore", "Stafford Mall", "DEKA", "Country Wide Building Society".
  - https://timdc.pastperfectonline.com/photo/43BE6BCE-0C7D-409C-BFAA-383537246350 and https://timdc.pastperfectonline.com/photo/257F0922-D774-4EE0-B5F7-562957345570 (1985-1995, "circa 1990"): "Taken from outside Faulks & Jordan Chemists looking northward along the street." Search terms include "Porters, giftware", "Camera World", "DEKA".
- Where that puts DEKA (inference, not proven): north of Faulks & Jordan, in the same view as the Stafford Mall's vertical "MALL" sign, so probably within the Strathallan-to-Canon block. Which side and which number are **(unverified)**.
  - Faulks & Jordan was probably on the WEST side, at the northbound bus stop. Inference from the catalogue text of https://timdc.pastperfectonline.com/photo/A61A8264-0805-4FA5-BE71-188993255505 : "Taken outside Faulks & Jordan Chemist's looking northward. Several businesses signs and three city buses are visible along the left and right of the image respectively." Shops on the left and buses on the right, looking north, means a west-footpath viewpoint with buses at the west kerb. The F&J address itself was not found.
- Look: `02-street-photographs.md` T12 (earlier viewing of the 1990 photo) records a yellow "DEKA" sign and the user's brief describes it as a hanging verandah sign. Lettering style, the dots in D·E·K·A, and any second colour are **(unverified)**.
- Building, storeys, frontage width, inside layout: **(unverified)**.
- Still there in 1995? Inference only: open in 1990; brand kept until 2001; no closure found. **(unverified for 1995 specifically)**.

---

## 2. Farmers, Stafford Street

Verdict: building and address CONFIRMED. Former department store CONFIRMED, but the history is Thomson's (1903-1961), then Hay's (1961-1982), then Farmers (1982 on). An escalator in the store about 1990 CONFIRMED. "Timaru's first escalator" **(unverified)**.

- Where: Coronation Buildings, 256-260 Stafford Street, west (inland) side, mid-block between Canon Street and the Church/Strathallan crossroads. OSM puts it about 95 to 105 m north of the Church Street corner, nearly opposite the Stafford Mall.
  - TDC record HHI49, Wayback copy of https://www.timaru.govt.nz/__data/assets/pdf_file/0006/673872/Historic-Heritage-Assessment-Report-HHI49-Coronation-Buildings-Category-A.pdf : "The building stands on the south-west side of Stafford Street in the middle of a block bordered by Canon Street to the north and Strathallan Street to the south."
- History: HHI49: "The Coronation Buildings were erected in 1902 by Thomas Thomson"; "officially opened on 2 January 1903"; "Thomson's... was bought by Hay's Department Store in 1961"; "the Farmers Trading Company acquired the property in 1982. Farmers still occupies the building, as well as the one immediately to the north of the Coronation Buildings, which was built in c.1910." Also https://en.wikipedia.org/wiki/Haywrights : "In 1961 Hay's purchased Timaru department store T. and J. Thomson (Est. 1883) they rebranded the store into Hay's and in 1982 it was converted to Farmers".
  - Correction to carry: the "former Hay's Buildings" on the Strathallan corner (229-237) are a different thing. They are named after William Hay, the retired sheep and cattle breeder who built them in 1907-08, not after Hay's department store. HHI45: "William Hay erected a number of commercial buildings along that portion of Stafford Street now numbered 229 to 251 in 1907/1908."
- Building and look: HHI49: "Two storey-building with irregular footprint and hipped and gabled roof forms. Elaborately decorated façade is symmetrical about an ornate pediment above a large arched opening on the first floor. End bays are marked by secondary pediments and oriel widows... Central pediment bears the name and date of the building in relief lettering." Materials: "Brick, cement plaster, metal roofing."
  - 1995-specific detail: the verandah on posts and the current shopfronts date from 1997. HHI49: "Removal of central first floor balcony over veranda; original veranda replaced by suspended veranda (date unknown). Modern shopfronts installed, veranda on posts reinstated, building restoration (1997)." So in 1995 Farmers had a **suspended** verandah and the pre-1997 shopfronts. A store "official opening" photo is dated 23 October 1997 (https://timdc.pastperfectonline.com/photo/B9DA5FDA-EFDB-42F4-BED9-534838804745 : "posed with balloons outside Farmers Timaru to mark its official opening, dated 23 October 1997"). Inference: the store was refitted and reopened in 1997.
  - Signs about 1990: red "FTC" signs (`02` T17, earlier viewing of https://timdc.pastperfectonline.com/photo/17093E0F-362E-49C5-A18F-152663867988 ). Whether still "FTC" or "Farmers" lettering in 1995 is **(unverified)**.
- Floors: the Coronation Buildings are two storeys. Whether Farmers traded on both floors in 1995 is **(unverified)**, but the escalator (next point) implies at least two trading levels (inference).
- Escalator: catalogue https://timdc.pastperfectonline.com/photo/2301B32F-5DEF-4BC1-9F63-419936540106 : "Wynne Raymond and an unidentified woman on an escalator at Farmers, Timaru, circa 1990." (year range 1985 to 2001). When it was installed, where it sits in the store, and whether it was Timaru's first: **(unverified)**. Papers Past, where an installation story would be, was blocked.
- Game hook from the record: https://timdc.pastperfectonline.com/photo/A916297D-9761-44A9-8694-735022182975 : "Farmers Timaru manager Brett Shea with Segas consoles, dated 26 August 1993. These were similar to machines that were stolen."

---

## 3. Stafford Mall

Verdict: address CONFIRMED (251 Stafford Street, east side). Trading in 1994-95 CONFIRMED. Opening year **(unverified)**, but it existed by 1986. Whether it ran through to another street **(unverified)**; it cannot have reached Sophia Street, which is on the opposite side.

- Address: present-day listings give "Stafford Mall Shop 11 251 Stafford Street Timaru" (Noel Leeming store page, Brave search excerpt) and "Glassons - Timaru ( 251 Stafford Street ) ... Stafford Mall Administration MERLINS TICKETEK BOOKING AGENCY" (Frontrunner directory, Brave excerpt). Both are search excerpts; the 251 number is consistent with the next two points.
- Side and block: east side, about 85 m north of the Church/Strathallan crossroads (OSM: 251 at ~283 m against the crossroads at 368 m). Catalogue https://timdc.pastperfectonline.com/photo/6C5E6557-8B54-4887-A3B6-385030183269 (1994-2010, "circa 2000?"): "Taken from just north of the intersection with Strathallan Street. McDonald fast food restaurant is just visible on the left and the Stafford Mall on the right." Looking north, right is east.
- The street building at 251: HHA1 Fig. 37: "Commercial building, 251 Stafford Street, 1906-8, T Coulthard Mullions, architect." HHI45: "The Rink Stables at 251 Stafford Street were the first part of Hay's building programme to be completed". So the mall's Stafford Street frontage is an Edwardian two-storey (typical for the street) facade at the north end of William Hay's 229-251 run. Inference: the mall was built into the deep former stables lot behind it.
- Existed by 1986: posters for Theatre Royal shows, "Book at Merlin Magic, Stafford Mall" (August 1986, https://timdc.pastperfectonline.com/archive/1301A41F-2B47-4948-A470-516102111281 ) and "Book at Merlins, Stafford Mall" (20 June 1986, https://timdc.pastperfectonline.com/archive/92ADAA2C-FED7-4543-859D-595258931804 ).
- In 1994 to 1997 (catalogue):
  - https://timdc.pastperfectonline.com/photo/77396998-2D63-4F75-B4CE-458689513842 : "Timaru Stafford Mall's manager Andrew Hogg, posed standing in front of the main entrance, dated 4 October 1994."
  - https://timdc.pastperfectonline.com/photo/3C0F7E00-4466-4CA2-B63C-475170187323 : "hanging some of the 'Gifts of Time' on the christmas tree in the Stafford Mall, Timaru, dated 5 December 1994."
  - https://timdc.pastperfectonline.com/photo/490834E1-CA16-44E1-AC20-355012158153 : "Kerry Turner (Stafford Mall manager)" and "Simon Hocking (Tenants Association Chairman)... dated 2 March 1997." So it had a tenants' association.
- Shops recorded in or at the mall:
  - Galvin's Bargains Galore, 1990: https://timdc.pastperfectonline.com/photo/3736B0D5-6D0A-4E1B-ABB2-431976820240 : "Galvin's Bargains Galore in the Stafford Mall, Stafford Street, Timaru, 1990." `02` T12 records a red and gold "Galvin's" fascia.
  - TAB agency, 1991: https://timdc.pastperfectonline.com/photo/CB7BC191-8AA5-4225-8049-346037045930 : "Geoff Keen, Stafford Mall TAB agent... dated 18 February 1991."
  - Merlins, 1986 to about 1995 (Section 7).
  - Noel Leeming, 1997: https://timdc.pastperfectonline.com/photo/120EBFFE-DCC7-409E-9A51-994429601290 : "posed standing in front of Noel Leeming's store in the Stafford Mall, dated 10 February 1997." Whether it was there in 1995 is **(unverified)**.
- Look: a vertical "MALL" sign on Stafford Street, about 1990 (`02` T12; "Stafford Mall" also legible in the postcard `02` T11). Inside layout, number of shops, car park, and any back entrance (towards the railway or Strathallan Street): **(unverified)**.
- Opening year: **(unverified)**. The 1977-78 Timaru Herald clippings about a "shopping mall" in Stafford Street are about pedestrianising the street, not this building (DigitalNZ, Aoraki Heritage Collection: "'Give shopping mall a trial in Stafford St'", 1 June 1978, https://aorakiheritage.recollect.co.nz/nodes/view/3508 ; "Council's buses dilemma- Pedestrian mall in Stafford St idea has support", 7 December 1977).

---

## 4. Northtown Mall

Verdict: location CONFIRMED (Evans Street and Hobbs Street, Waimataitai / Grantlea; Evans St was SH1). Trading 1990-1996 CONFIRMED. Opening year **(unverified)** (sources disagree). Anchor in 1995 **(unverified)**.

- Location: OSM / Nominatim: "Northtown Mall, 98, Evans Street, Grantlea, Waimataitai, Timaru" (-44.38328, 171.23672), about 1.6 km west and 1.9 km north of the south end of Stafford St. The Pak'nSave side faces Hobbs Street: Stuff, 21 June 2016 (Wayback copy of https://www.stuff.co.nz/timaru-herald/news/81302262/timaru-pak-n-save-extension-progresses ): "cranes moved concrete wall sections into place at the Hobbs St supermarket."; "The supermarket's extension into its own car park is expected to include some cosmetic work on the rest of the Northtown Mall complex." So it had its own surface car park.
- Suburb: https://en.wikipedia.org/wiki/Waimataitai : "Northtown Mall opened at Waimataitai in the 1970s." (the cited source does not say this, so treat the decade as weak). https://en.wikipedia.org/wiki/List_of_shopping_centres_in_New_Zealand gives "Mid-1990s" and wrong coordinates. Neither is reliable. Opening year **(unverified)**. The 1990-91 photos below prove it existed before the mid 1990s.
- Pak'nSave: Stuff, 20 March 2017 (Wayback copy of https://www.stuff.co.nz/timaru-herald/news/90611815/upgrade-of-pak-n-save-timaru-expected-to-be-complete-in-july ): "some equipment was about 20 years old as the store opened in the mid 1990s". Whether Pak'nSave was open by 1995 is **(unverified)**.
- Tenants recorded 1990 to 1996 (catalogue):
  - Northtown Nutrition and Northtown Hair Studio, 1 February 1991: https://timdc.pastperfectonline.com/photo/DA0D4F22-CD1C-4954-94EF-108805591233 : "posed standing in Northtown Mall in front of Northtown Nutrition and Northtown Hair Studio". Northtown Nutrition again 3 April 1996 ( https://timdc.pastperfectonline.com/photo/162E2C72-CAF7-4B7F-BFE1-235171242782 ).
  - Trustbank: https://timdc.pastperfectonline.com/photo/B9BFF96B-20FD-4263-A3D8-288266401340 : "Mark Rogers, manager Northtown branch of Trustbank South Canterbury, dated 13 September 1994." (Inference: the branch was in or by the mall.)
  - Northtown Tavern (Hobbs St): Aoraki Heritage clipping "Hobbs St tavern approved; council over-ruled", 28 August 1981, https://aorakiheritage.recollect.co.nz/nodes/view/5590 : "The 'Northtown tavern' operated until it was closed in [year garbled in source]. The building was demolished in 2021." A 1993 photo names the "Northtown Tavern Social Club" ( https://timdc.pastperfectonline.com/photo/6F125A8E-4A83-404C-80A2-456982230399 ).
  - Events: an art exhibition and sale in the mall, 7 December 1990; a hospice Christmas tree, December 1996.
- Look and size: **(unverified)**.

---

## 5. Highfield Mall

Verdict: location CONFIRMED in present-day data (Wai-iti Road at Sealy St / Chalmers St, Highfield). Supermarket opened 8 December 1971 CONFIRMED. Tenants about 1989-90 CONFIRMED. Tenants in 1995 and look **(unverified)**.

- Name: today "Highfield Village Mall"; in 1989 "Highfield Mall" (catalogue below). https://en.wikipedia.org/wiki/Highfield,_New_Zealand : "The Highfield Village Mall includes a New World supermarket."
- Location: OSM: the New World building is at -44.38969, 171.22646 (Nominatim: "New World, Sealy Street, Highfield"). The streets around it are Wai-iti Road (secondary road, about 25 m away), Sealy Street, Chalmers Street, Wrights Avenue, St Johns Avenue and Branscombe Street. The Wikipedia list's mall coordinate (-44.39006, 171.22593) sits on Wai-iti Road. Exact frontage street in 1995 **(unverified)**.
- Supermarket: Aoraki Heritage clipping "Highfield Super Value", 8 December 1971, https://aorakiheritage.recollect.co.nz/nodes/view/551 : "Opened in 1971 on the site of the current New World supermarket." Others on the same day: "Highfield Super Value Supermarket Opens Today".
- Tenants recorded (catalogue):
  - "Alastair Chapman, owner of Highfield Supervalue Supermarket", circa 1990.
  - "Joe and Ann Tiller... at their Highfield Pharmacy, Timaru, circa 1990." ( https://timdc.pastperfectonline.com/photo/FF7284C1-6A1D-432C-AB2A-928681749992 )
  - "Les Whitley of Timaru's Highfield Post Shop, circa 1990." ( https://timdc.pastperfectonline.com/photo/4C5BB54E-7E62-4A67-8293-116204679815 ). Inference: in the mall.
  - "Roberta Fraser of Highfield Mall's Jack & Jill's shop, dated 17 October 1989", with "the store's closing down sale" ( https://timdc.pastperfectonline.com/photo/C88AEA92-2C69-45BA-BF75-773072338224 ). So Jack & Jill's was gone by 1995.
  - Wikipedia's list says "8" shops and "100" car parks, citing a South Canterbury Chamber of Commerce page that I could not open. **(unverified)**.

---

## 6. Other malls and arcades about 1995

- **Royal Arcade** (CONFIRMED). Location: 196-200 Stafford Street, west side, a pedestrian lane through to 23-29 Sophia Street, in the block between Church Street and George Street. TDC record HHI202, Wayback copy of https://www.timaru.govt.nz/__data/assets/pdf_file/0004/674023/Historic-Heritage-Assessment-Report-HHI202-Ross-Royal-Arcade-Royal-Arcade-Category-A.pdf : "The Royal Arcade is a pedestrian laneway that extends between Stafford Street in the north-east and Sophia Street in the south-west. It is located in the block bounded by Church Street in the north and George Street in the south". "Buildings lining the arcade are two-storeys in height and many have cellar or basement levels." "At its mid-point the arcade is bridged at first floor level".
  - In 1995 it was mid-restoration and had NO glass roof yet. HHI202: "Ross's intention to roof his arcade with an arched glass canopy was not realised until the right of way was upgraded in the mid-1990s... the restoration of the Royal Arcade, which reopened on 31 May 1996." A museum album lists "The roofing of the Royal Arcade, November 1996" (catalogue keyword search). Those two dates disagree on when the roof went on.
  - Tenants: "Boobs, a second-hand clothing store, was a longstanding tenant from the mid-1970s" (HHI202). An earlier refit opened it as "the Plaza complex" in April 1973: Aoraki Heritage, 26 April 1973, https://aorakiheritage.recollect.co.nz/nodes/view/432 : "Articles about the opening of the Plaza complex (the Royal Arcade, refurbished)."
  - OSM puts the Stafford Street mouth about 105 m south of the Church Street corner, nearly opposite Stafford Chambers.
- **Woolworths supermarket, Church Street** (opened 1973 CONFIRMED; still there in 1995 **unverified**). Aoraki Heritage clippings: "New Woolworths Supermarket for Church Street" (29 March 1973); "Thousands Pack New Supermarket" (20 September 1973) (DigitalNZ, Aoraki Heritage Collection). Catalogue: "Tony Franc, manager of Woolworths, 3 February 1994"; "checking over plans for reovations at Woolworths, Timaru, dated 3 February 1994". Inference: the same Church Street store, renovated in 1994. Street number **(unverified)**.
- **Northtown** and **Highfield**: Sections 4 and 5.
- **Hoyts cinema, Canon Street**: NOT there in 1995. A museum album lists "Canon Street, August 1995 - before demolition to make way for a Hoyts cinema". Opening date **(unverified)**.
- No other Timaru mall names were found for 1995. A College Road supermarket was proposed in 1972-73 ("College Road Supermarket By Late 1974", Aoraki Heritage, 16 June 1973); whether it was built is **(unverified)**.

---

## 7. Merlins (Merlins Music & Magic)

Verdict: CONFIRMED in the Stafford Mall (251 Stafford St, east side) from 1986 to at least 1994, with an owner photo "circa 1995". What it sold is only partly known.

- Names used: "Merlin Magic, Stafford Mall" (1986), "Merlins, Stafford Mall" (1986), "Merlins Music and Magic" (1991), "Merlins" (1992, 1994). Sources are Theatre Royal posters in the museum's archive:
  - https://timdc.pastperfectonline.com/archive/1301A41F-2B47-4948-A470-516102111281 (Caravan, 4-6 August 1986): "Book at Merlin Magic, Stafford Mall for the shows held at the Theatre Royal, Timaru."
  - https://timdc.pastperfectonline.com/archive/92ADAA2C-FED7-4543-859D-595258931804 (DB Gold Guitar Roadshow, 20 June 1986): "Book at Merlins, Stafford Mall".
  - https://timdc.pastperfectonline.com/archive/CCF39F9B-9A25-4CD8-9A46-755604210673 (NZ Ballet, La Sylphide, 25 May 1991): "Book at Merlins Music and Magic".
  - https://timdc.pastperfectonline.com/archive/2BD08C85-EB03-41C2-87E6-013113767802 (The Warratahs, 28 August 1992): "Bookings Merlins."
  - https://timdc.pastperfectonline.com/archive/9417E831-9BDB-4553-9692-824537048089 (Suzanne Prentice, 2 November 1994): "Bookin at Merlins".
- About 1995: https://timdc.pastperfectonline.com/photo/38962735-14C8-472E-A002-940549657456 : "Betty Manning, owner of Merlins store, circa 1995." and https://timdc.pastperfectonline.com/photo/3FD686A7-F4CC-4D82-94AD-549250712076 : "Betty Manning, owner of Merlins pictured in Stafford Street with some of her store goods, circa 1995." (catalogue range 1985 to 2001).
- What it was:
  - CONFIRMED: the town's ticket booking agency for Theatre Royal shows from 1986 to 1994. A present-day directory excerpt (Frontrunner) lists "MERLINS TICKETEK BOOKING AGENCY" with the Stafford Mall entries, so it later became a Ticketek agent; Ticketek in 1995 is **(unverified)**.
  - "Music & Magic": the name and a present-day directory category ("Music store", thefamilycompany.co.nz search excerpt, "251 STAFFORD STREET") point to music retail. Whether that meant records/CDs/tapes, sheet music or instruments, and whether "Magic" meant magic tricks, jokes or games, is **(unverified)**. The "store goods" photo would answer this; I could not view it.
- Which block is 251: Stafford Street, east side, between the Church/Strathallan crossroads (about 85 m south) and Canon Street, at the north end of the 229-251 Hay's Buildings run, nearly opposite Farmers (Sections 0c and 3).

---

## 8. The Old Mill

Verdict: a nightclub ("Old Mill night club", also "Old Mill Cabaret") in the former Belford Flour Mills, 2-4 North Street. Operating in 1982 and in 2004 CONFIRMED. Operating in 1995 is an inference from those two dates, not proven.

- Building and address: TDC record HHI54, Wayback copy of https://www.timaru.govt.nz/__data/assets/pdf_file/0011/673877/Historic-Heritage-Assessment-Report-HHI54-Former-Belford-Flour-MIlls-Category-B.pdf : "former Belford Flour Mills... 2-4 North Street, Timaru"; "DATE OF CONSTRUCTION 1877-78"; HNZ list number "3160 / 2". Wuhoo Timaru, https://www.wuhootimaru.co.nz/blog/1220-the-grain-giants-belford-flour-mills-and-timaru-s-oldest-surviving-mill : "Now listed by Heritage New Zealand as Old Mill Cabaret Ltd (Former Belford Mill)".
- Where: HHI54: "The former flour mill stands on the south side of North Street, immediately west of the Timaru railway line. The port of Timaru lies to the north/north-east of the mill." Nominatim puts 2 North Street about 100 m east of the Stafford/North Street corner and 13 m south of it. North Street meets Stafford Street about 1,040 m south of the Bay Hill end (Section 0c). So the club is down a short side street off the south end of Stafford Street, beside the railway, at the port's edge.
- Look: HHI54: "Multi-level building with irregular rectangular footprint and hipped and gabled roof forms. Built up against a bank, so west elevation is one and two-storeys in height, east elevation has two, three and four-storey sections. Canopy over ground floor on east side shelters former railway siding. Most door and window openings have shallow-arched heads. Roof ventilators, north elevation built to road boundary, vestigial lettering 'Belford Flour Mills' on east elevation." Materials: "Brick, concrete, timber, corrugated iron roofing." So from North Street it looks low (one or two storeys); from the railway side it is a four-storey brick wall with a ghost sign.
- Nightclub history: HHI54: "Milling operations ceased in 1947 and the building was purchased by New Zealand Breweries and used as a grain store. After it was sold to Chrome Platers Ltd in 1974 part of the former mill was converted for use as a nightclub." ADDITIONS: "Nightclub conversion (post-1974)."
- Operating dates (catalogue):
  - https://timdc.pastperfectonline.com/photo/9759FA54-CB2F-4499-B698-896214881909 : "Provides views of the interior of the Old Mill night club in October 1982."
  - https://timdc.pastperfectonline.com/photo/807E8F2B-4C03-44F9-8D52-525197696176 : "The Monty Show Band performing at a reunion at the Old Mill Night Club... in 2004."
- Bar or pub? It is described as a night club / cabaret, not a hotel or tavern. Licence type, opening nights and inside layout in 1995: **(unverified)**.

---

## 9. Boy racers, "doing the drag", Friday-night burnouts on Stafford Street

Verdict: **STILL UNVERIFIED** for Timaru. No source found.

- The geography is real: Church Street meets Stafford Street at a signalised crossroads with Strathallan Street (Section 0b). In 1995 Stafford Street was also SH1 (`07` item 8f), so it carried through traffic.
- Searched with no result: museum catalogue ("hoon*", "burnout*", "cruis* AND Stafford", "drag AND Stafford"; "boy racer*" returned only motor-sport portraits); DigitalNZ / Aoraki Heritage Collection clippings ("boy racers", "hoons", "drag racing", "cruising"); Wuhoo Timaru site search ("boy racer", "burnout", "cruising"). Papers Past and the web search engines were blocked.
- Background already in `07` (Christchurch, not Timaru): Te Ara: "'Boy racers' were youths who were into cars in the 1990s and the early 21st century. In the 1970s and 1980s they would have been termed 'hoons'."
- Related street detail (no date): Wikipedia says the South Island's Barnes Dances (all-way pedestrian crossings) include "Stafford Street in Timaru" ( https://en.wikipedia.org/wiki/Pedestrian_scramble ). Whether any existed in 1995, and at which intersection, is **(unverified)**.
- For the game: a Friday-night loop of Stafford Street through the Church/Strathallan lights is plausible fiction. Present it as invented, not as recorded history.

---

## 10. Pātītī Point and South Beach

Verdict: Pātītī Point is south of the port and of Caroline Bay (CONFIRMED). Car park, Rotary archway (1990 plaque) and lookout existed by 1995 (CONFIRMED). The Benvenue / City of Perth memorial is NOT confirmed at Pātītī. South Beach lies south of the port (CONFIRMED); its full extent, surf club and camping ground are **(unverified)**.

- Name and te reo: Kā Huru Manu (Ngāi Tahu atlas; data read from the saved layer /private/tmp/the03-research/working/ingoa_0.json): headword "Pātītī", common name "Patiti Point": "Pātītī Point is located on the South Canterbury coastline at Timaru. Pātītī was a passenger on the Ārai-te-uru waka, which capsized off Matakaea on the North Otago Coastline... Most did not make it, including Pātītī, and instead were transformed into many of the well-known landmarks of Te Waipounamu. In 1880, Hoani Kāhu from Arowhenua described Pātītī as 'he kāinga nohoanga, mahinga kai, and he tauraka a waka'." Use the macrons: Pātītī Point. (`07` Part B covers mana whenua: Te Rūnanga o Arowhenua.)
- Position against the port: HHA1: Hewlings surveyed the government town "between North Street and Patiti Point"; "the sheltered waters immediately north of Patiti Point seemed the natural place for a port to develop." Atlas coordinates: Pātītī -44.41162, 171.26459; OSM cape node -44.41212, 171.26496. That is about 1.3 km south-south-east of central Timaru, with the port between it and Caroline Bay.
- Surf: https://en.wikipedia.org/wiki/Timaru : "Patiti Point, near Timaru city, has a left-hand reef break, which operates very consistently in any swell from the east or south."
- Whaling: Wikipedia Timaru: "a whaling station in 1839 by the Weller brothers of Otago at Patiti Point". Wuhoo scenic route stop 3 ( https://www.wuhootimaru.co.nz/timaru-scenic-route/328-3-patiti-point ): "A whale pot (for rendering blubber) at the current-day carpark is a reminder of this part of the area's history." The pot was at the point by 1990: catalogue photo cited on https://www.wuhootimaru.co.nz/blog/878-did-you-know-that-the-reserve-at-patiti-point-was-championed-by-rotary : "The President of the Timaru South Rotary club, Bob Southgate, posed with a large anchor, and a whale pot in the background, dated 25 June 1990."
- What is there: a grassy reserve on top of cliffs, a car park, a lookout and a railing.
  - Aoraki Heritage, https://aorakiheritage.recollect.co.nz/nodes/view/4899 : "Photographs of the archway (including close up of the 1990 Rotary plaque set into the stonework) at the entrance to the Patiti Point car park". So the stone archway was there in 1995.
  - Lookout: Wuhoo on Win Parkes's 1984 council guide ( https://www.wuhootimaru.co.nz/blog/1039-discovering-timaru-published-by-the-timaru-city-council-in-1984-by-win-parkes-1984 ): "from the tip of the Patiti Point lookout, you could once stand and look south to see the natural shoreline, then look north to see the coast transformed by the port's construction."
  - Reserve and railing: Wuhoo ( https://www.wuhootimaru.co.nz/blog/1085-inspired-by-a-information-sign-the-rise-and-fall-peeress-town ): "If you stand on the grassy reserve above Patiti Point today... The tussock, the surf and the coastline". Wuhoo ( https://www.wuhootimaru.co.nz/blog/1519-what-is-the-abandoned-building-below-patiti-point ): "reached the railing and looked down? Below the cliff sits a derelict concrete building covered in graffiti." That building was probably part of the council crushing and road-mixing plant moved there in 1944. Present in 1995 is likely but **(unverified)**.
  - Railway: the main south line runs along this coast ("high seas threaten parts of the main rail line south of Timaru, especially around Patiti Point to Jacks Point", Wuhoo search excerpt).
  - Bluestone picnic/BBQ area and Holmglen memorial (ship lost 1959) are at Pātītī today (Aoraki Heritage photos 2023). Their build dates, and so whether they existed in 1995, are **(unverified)**.
- Benvenue / City of Perth memorial: a "Seafarers monument" commemorates the 1882 Benvenue and City of Perth wreck rescues (Aoraki Heritage, https://aorakiheritage.recollect.co.nz/nodes/view/1506 : "Monument dedicated to those involved in the rescue attempts when the ships the 'Benvenue' and the 'City of Perth' were shipwrecked in 1882."). A clipping title "Seafarers service at the Benvenue memorial" (16 October 1972) shows it existed long before 1995. Its location is **(unverified)**. Nothing places it at Pātītī Point; do not put it there without a source.
- South Beach:
  - Position: south of the port. https://en.wikipedia.org/wiki/Longshore_drift : the port "blocked the drift of these (coarse) sediments and instead caused them to accrete to the south of the port at South beach in Timaru." OSM has "South Beach Carpark, South Street" at -44.41084, 171.26252, beside Pātītī Point.
  - Cliff above it: Wuhoo (Rotary page): "In 1910 a foghorn was erected on the cliff overlooking South Beach."
  - Surface: the drift material is "coarse" (Wikipedia, above), which suggests shingle and gravel. Sand vs shingle in 1995 is **(unverified)**.
  - Extent, surf club, camping ground: **(unverified)**. Nothing found.
- Saltwater Creek / Ōtipua wetland: further south, at the King Street (SH1) bridge. Wuhoo stop 4 ( https://www.wuhootimaru.co.nz/timaru-scenic-route/329-4-otipua-wetlands-saltwater-creek ): "Ōtipua Wetland is on State Highway One. Enter from the south side of the road bridge on King Street. Or drive to the end of Scarborough Rd. Or you can take the Coastal Track through the cemetary, along the coast." Today's restored wetland (gifted back to TDC in 2016) is later than 1995. What the creek mouth looked like in 1995 is **(unverified)**.
- Road access:
  - CONFIRMED: South Street runs to Pātītī Point and its car park (Wuhoo stop 3 is headed "SOUTH ST"; OSM "South Beach Carpark, South Street"; Wuhoo: "On South Street at Patiti Point, there are trees that were planted as part of a fundraiser").
  - Hayes St, Bidwill St, Wai-iti Rd, "Marine Parade south" as access routes: **(unverified)**. No source opened ties them to Pātītī. Wai-iti Road is the Highfield road (Section 5), inland and to the north-west.
  - How South Street connects to Stafford/King Street: the OSM extract did not join them directly. **(unverified)**, check a map.

---

## 11. New Zealand curve chevrons (PW-66 / PW-67)

Verdict: colours, codes, mounting height, spacing rules and warrants CONFIRMED from MOTSAM Part 1 (Edition 4, 1998, as updated to 2010). Exact sizes **(unverified)**. Black-on-yellow in 1995 is PROBABLE (yellow warning signs from 1987), not directly confirmed for chevrons.

Source: Transit NZ / NZTA, Manual of Traffic Signs and Markings (MOTSAM) Part 1, Section 6 "Permanent warning signs", pages 6-92 to 6-95 dated January 2010. Wayback copy of http://www.nzta.govt.nz/assets/resources/motsam/part-1/docs/motsam-1-section-06.pdf . Edition history from Section 0: "Edition 4 September 1998 February 1999", then updates in 2000, 2007, 2009, 2010.

- Two sign types:
  - **PW-66, Horizontal curve chevron board**: one wide board with several chevrons, placed where approaching drivers look straight at it. "A PW - 66 HORIZONTAL CURVE CHEVRON BOARD sign shall have black chevrons on a rectangular reflectorised yellow background plate." Urban boards may be shortened "to show only two chevrons". The advisory speed must also be shown on the board: "The speed shown on the PW curve warning advisory sign combination must also be shown on the PW - 66 sign, as illustrated in diagram PW - 66(b)."
  - **PW-67, Chevron curve indicator**: single chevrons on posts, repeated round the outside of the curve. "A PW - 67 CHEVRON CURVE INDICATOR sign shall have a black chevron on a rectangular reflectorised yellow background plate."
- When used:
  - PW-66: "PW-66 signs should, however, normally be used where: (i) the curve advisory speed is 15km/h, or (ii) the advisory speed is higher than 15 km/h and Size D PW curve warning advisory signs are warranted." Sequence: "An appropriate PW curve warning advisory sign combination must be erected in advance of a PW - 66 sign which in turn should for long curves be followed by a series of PW - 67 Chevron Curve Indicator signs".
  - PW-67: "may be used on horizontal curves where the installation of a PW - 66 sign is not warranted but... some additional delineation is required... A typical example situation is a long, large deflection angle, horizontal curve." "PW - 67 signs must not be used unless an appropriate PW curve warning sign or sign combination is erected." Warrants and sizes refer to "Appendix A3: Guidelines for the Installation of Curve Warning and Advisory Speed Signs". Advisory speed plates (PW-25) end in 5, e.g. 35, 45, 65 ( https://en.wikipedia.org/wiki/Road_signs_in_New_Zealand ).
- Spacing and placement (PW-67): "At least three PW -67 signs should be provided for each direction of travel. They must be erected at equal spacings on the out side of horizontal curves and in such a manner that approaching drivers will always have at least two in view at all times." First sign on a left-hand curve on a two-way road: "On the prolongation of the centre of the road". First sign on a right-hand curve: "On the prolongation of the left hand edge line or the left hand edge of the sealed road surface". Last sign: "must be located at the tangent point of the curve". "Intermediate PW - 67 signs must be equally spaced between the first and last". If a PW-66 is warranted, it replaces the first PW-67.
- Mounting height: PW-66 and PW-67 "mounted so that the underside of the signs are at least 1.0 m above the adjacent sealed road surface", higher where sight distance is short; PW-67 "at a constant height... and at a constant lateral distance". Turn them away from the driver's line of sight: "by an absolute minimum of 5 degrees... but preferably by 10 degrees". Supports must be "breakaway or yielding" where they could be hit.
- Sign backs: Section 1: "Unless otherwise specified sign panel backs should be coloured aircraft grey".
- Size: "PW -67sign siz e is dependent on the application, i.e. whether it is rural or urban application. The minimum sizes for urban and rural situations are shown in the Traffic Control Devices Specifications." I could not get those specifications. Millimetre sizes **(unverified)**.
- Wikipedia's NZ sign gallery shows the multi-chevron curve marker as file "New_Zealand_PW-66_(2_chevrons_left).svg" and "(4 chevrons ...)", so the code for the multi-chevron board is PW-66. The single post chevron is PW-67.
- 1995 colours: https://en.wikipedia.org/wiki/Road_signs_in_New_Zealand : "Most of these signs were only introduced between 1987 and 1990, replacing older-style signs with white text on black backgrounds: square with a red border for regulatory signs and diamond with a yellow border. Warning signs and the Give Way sign were replaced from 1987"; "Some of the older signs can still be seen on some rural roads." (cites The Press, 23 February 1989, p. 21, "More road signs to change"; Papers Past was blocked so I did not read it). Edition 4 of MOTSAM is from 1998, so the 1995 rules came from the earlier edition, which I did not find. Inference: black chevrons on reflective yellow were standard on 1995 state highways, with some pre-1987 black-background signs possibly still up on back roads. The PW-66/PW-67 code numbers in 1995 are **(unverified)**.

---

## Corrections to carry into the game notes

- "Hay's Buildings" (229-237, on the Strathallan corner) are named for William Hay the farmer-developer. Farmers sits in the Coronation Buildings (256-260), which Hay's department store owned from 1961 to 1982. They face each other across Stafford Street.
- Farmers' verandah on posts is a 1997 reinstatement. In 1995 it had a suspended verandah.
- Stafford Mall is on the east (railway) side at 251, so it cannot run through to Sophia Street. The arcade that reaches Sophia Street is the Royal Arcade (west side, 196-200).
- The Royal Arcade's glass roof dates from 1996. In 1995 it was an open lane under restoration.
- The Old Mill is a nightclub in an 1877-78 flour mill on North Street, off the south end of Stafford Street. It is not a pub on Stafford Street itself.
- Merlins was in the Stafford Mall and was the town's Theatre Royal booking office.
- Chevrons: PW-66 is the multi-chevron board, PW-67 the single post chevron. Both black on yellow.

## Still unverified

1. DEKA's street number, side, building, frontage and lettering; whether still open in 1995.
2. Faulks & Jordan Chemists' address (only inferred to be on the west side, at the bus stop).
3. Farmers: when the escalator was installed, where it is, and whether it was "Timaru's first"; trading floors in 1995; sign lettering in 1995.
4. Stafford Mall: opening year, inside layout, number of shops, any rear entrance or car park, tenant list for 1995.
5. Northtown Mall: opening year, 1995 anchor (Pak'nSave "mid 1990s" might be just after), look and size.
6. Highfield Mall: 1995 tenants, frontage street, look.
7. Woolworths Church Street in 1995 and its street number; Hoyts Canon Street opening date.
8. Merlins' goods (music formats, magic tricks or not); Ticketek in 1995.
9. The Old Mill operating in 1995 specifically (inferred from 1982 and 2004); licence type and layout.
10. Any Timaru source for 1990s cruising, burnouts or boy racers on Stafford Street; Barnes Dance dates.
11. Seafarers (Benvenue / City of Perth) memorial location; dates of the Pātītī BBQ area and Holmglen memorial.
12. South Beach extent, surface (sand or shingle), surf club, camping ground; road links via Hayes, Bidwill, Wai-iti, Marine Parade.
13. Chevron sizes in millimetres; 1995 MOTSAM edition, codes and colours.
