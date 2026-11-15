import { test } from "node:test";
import assert from "node:assert/strict";
import { sellPagePlatform } from "../../extension/src/sellPages";

test("recognizes pages where the user is creating a listing", () => {
  const cases: [string, string | null][] = [
    ["https://poshmark.com/create-listing", "poshmark"],
    ["https://poshmark.com/edit-listing/6ad1bb5c3869377bc8952e3f", "poshmark"],
    ["https://www.ebay.com/sl/sell", "ebay"],
    ["https://www.ebay.com/sl/prelist/suggest?title=bag", "ebay"],
    ["https://www.ebay.com/lstng?draftId=123&mode=AddItem", "ebay"],
    ["https://www.facebook.com/marketplace/create/item", "facebook"],
    ["https://www.facebook.com/marketplace/create/vehicle", "facebook"],
    ["https://www.facebook.com/marketplace/edit/?listing_id=1", "facebook"],
    // buying, browsing and lookalikes are not sell pages
    ["https://poshmark.com/listing/Coach-Bag-6ad1bb5c3869377bc8952e3f", null],
    ["https://poshmark.com/closet/someone", null],
    ["https://www.ebay.com/itm/123456", null],
    ["https://www.ebay.com/sh/ovw", null],
    ["https://www.facebook.com/marketplace/item/123", null],
    ["https://www.facebook.com/marketplace/createlisting-scam", null],
    ["https://poshmark.com.evil.example/create-listing", null],
    ["http://poshmark.com/create-listing", null],
    ["not a url", null],
    [undefined as unknown as string, null],
  ];
  for (const [url, platform] of cases) assert.equal(sellPagePlatform(url), platform, url);
});
