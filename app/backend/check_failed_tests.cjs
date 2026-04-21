
const fs = require('fs');
const results = JSON.parse(fs.readFileSync('test-results.json', 'utf8'));

results.testResults.forEach(suite => {
  if (suite.status === 'failed') {
    console.log(`FAIL: ${suite.name}`);
    suite.assertionResults.forEach(test => {
      if (test.status === 'failed') {
        console.log(`  x ${test.title}`);
        test.failureMessages.forEach(msg => console.log(msg));
      }
    });
  }
});
