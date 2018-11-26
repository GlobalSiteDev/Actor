const Apify = require('apify');

const zipcode = '10081';
const searchUrl = 'https://www.amazon.com/s/ref=glow_cls?url=search-alias%3Daps&field-keywords=';
const offerUrl = 'https://www.amazon.com/gp/offer-listing/';

const humanDelay = ms => (Math.random() + 1) * ms;

const getOffers = async (page) => {
    return await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.olpOffer'))
                    .map(offer => ({
                        sellerName: offer.querySelector('.olpSellerName').textContent.trim(),
                        offer:      offer.querySelector('.olpOfferPrice').textContent.trim(),
                        shipping:   offer.querySelector('.olpShippingInfo').textContent.slice(2, 7).toLowerCase().trim()
                    }))
    })
}

const getTitle = async (page, selector) => {
    return page.$eval(selector, el => el.textContent.trim());
}

const getDescription = async (page) => {
    return await page.evaluate(() => {
        let description = document.getElementById('productDescription');
        let bullets = document.getElementById('feature-bullets');

        // Checking if there's a description section on the page than saving it
        // If not, saving feature bullets to description
        return description === null ? bullets.textContent.trim() : description.textContent.trim();
    });
}

const getAttributeValue = async (page, selector) => {
    return page.$eval(selector, el => el.getAttribute('data-asin'));
}

Apify.main(async () => {
    const input = await Apify.getValue('INPUT')
    
    if (!input || !input.keyword) throw new Error('Invalid input, must be a JSON object with the "keyword" field!')

    const browser = await Apify.launchPuppeteer();
    const user = await Apify.client.users.getUser();
    const page = await browser.newPage();

    const store = await Apify.openDataset();

    const datasetInfo = await store.getInfo();
    const storeId = datasetInfo.id;
    const datasetLink = `https://api.apify.com/v2/datasets/${storeId}/items?token=XSMDrfYpFHw4Qdv9kBAHa2gj3`;

    console.log('Going to search results page...');
    await page.goto(searchUrl + input.keyword);


    // Setting a delivery address to New York City, US (ZIPCODE: 10081)
    // This part of code doesn't wor on Apify platform but works on my local machine
    await page.click('.nav-a.nav-a-2.a-popover-trigger.a-declarative');
    await Apify.utils.sleep(3000);
    await page.type('#GLUXZipUpdateInput', zipcode, humanDelay(100));
    await page.click('#GLUXZipUpdate', { delay: humanDelay(100) });
    await page.click('[name="glowDoneButton"]', { delay: humanDelay(100) });
    await new Promise(resolve => setTimeout(resolve, humanDelay(5000)));


    console.log('Openeing request queue...');
    const requestQueue = await Apify.openRequestQueue();

    console.log('Going to product details page...');
    await Apify.utils.puppeteer.enqueueLinks(
        // page from which to extract URLs
        page,

        // selector under which to look for URLs
        '#s-results-list-atf .s-result-item:not(.AdHolder) a.s-access-detail-page',

        requestQueue
    );

    const crawler = new Apify.PuppeteerCrawler({
        launchPuppeteerFunction: () => browser,

        handlePageFunction: async ({ request, page: productDetailsPage }) => {
            const title = await getTitle(
                productDetailsPage,
                '#productTitle'
            );

            const description = await getDescription(
                productDetailsPage
            );

            // Gettin an asin from the Product details page
            const asin = await getAttributeValue(
                productDetailsPage,
                '#averageCustomerReviews'
            );

            await page.goto(offerUrl + asin);

            let offers = await getOffers(page);

            const data = {
                title,
                itemUrl: request.url,
                description,
                keyword: input.keyword,
                offers: offers
            };
            // Save data in storage.
            await Apify.pushData(data);
        },

        requestQueue,
        maxRequestsPerCrawl: 5 // For quicker testing, delete in prod
    })

        await crawler.run()
    
    await browser.close()

    console.log(`Sending email to ${user.email}...`);
    await Apify.call('apify/send-mail', {
        to: user.email,
        subject: 'Amazon iPhone offers',
        html: `
            <div style="height: 300px;
                        padding: 20px;
                        background-image: linear-gradient(to right, #00184d, #0039b3);
                        border-radius: 5px;
                        color: #fff;">
                <h1>New offers for iPhones</h1>
                <h3>Follow the link to check out all offers</h3>
                ${datasetLink}
            </div>`,
    });
})