const { detectCTA } = require("./ctaDetector");

const cases = [
    {
        text: 'Drop the word “Free” and I’ll send it to you.',
        expectedType: 'COMMENT',
        expectedKeyword: 'FREE'
    },
    {
        text: 'Drop FREE for the link',
        expectedType: 'COMMENT',
        expectedKeyword: 'FREE'
    },
    {
        text: 'Drop VIDEO for the link',
        expectedType: 'COMMENT',
        expectedKeyword: 'VIDEO'
    },
    {
        text: 'Type “VIDEO” below',
        expectedType: 'COMMENT',
        expectedKeyword: 'VIDEO'
    },
    {
        text: 'Comment “VIDEO” to get the link',
        expectedType: 'COMMENT',
        expectedKeyword: 'VIDEO'
    },
    {
        text: 'Comment TEST if you want the link',
        expectedType: 'COMMENT',
        expectedKeyword: 'TEST'
    },
    {
        text: 'Comment “SETUP” and I’ll send the setup',
        expectedType: 'COMMENT',
        expectedKeyword: 'SETUP'
    },
    {
        text: 'Comment anything for the link',
        expectedType: 'COMMENT',
        expectedKeyword: 'ANYTHING'
    },
    {
        text: 'Comment MIMO and I will send you the setup',
        expectedType: 'COMMENT',
        expectedKeyword: 'MIMO'
    },
    {
        text: 'Comment below VIDEO for the link',
        expectedType: 'COMMENT',
        expectedKeyword: 'VIDEO'
    },
    {
        text: 'Comment "Link" and I\'ll share you the details 💸',
        expectedType: 'COMMENT',
        expectedKeyword: 'LINK'
    }
];

let failed = 0;

for (const c of cases) {
    const res = detectCTA(c.text);
    const pass = res.type === c.expectedType && res.keyword === c.expectedKeyword;

    if (pass) {
        console.log(`PASS: "${c.text}" => ${res.keyword}`);
    } else {
        failed += 1;
        console.error(`FAIL: "${c.text}"`);
        console.error(`  Expected: type=${c.expectedType}, keyword=${c.expectedKeyword}`);
        console.error(`  Actual:   type=${res.type}, keyword=${res.keyword}`);
    }
}

if (failed > 0) {
    console.error(`\n${failed} CTA tests failed.`);
    process.exit(1);
} else {
    console.log(`\nAll ${cases.length} CTA tests passed successfully!`);
}