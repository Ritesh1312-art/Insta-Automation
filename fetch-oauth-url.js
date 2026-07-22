fetch('https://insta-automation-vert.vercel.app/api/auth/meta/url')
  .then(res => res.json())
  .then(data => console.log(data.url))
  .catch(console.error);
