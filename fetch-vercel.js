fetch('https://insta-automation-vert.vercel.app/api/stats')
  .then(res => res.json())
  .then(data => console.log(JSON.stringify(data, null, 2)))
  .catch(console.error);
