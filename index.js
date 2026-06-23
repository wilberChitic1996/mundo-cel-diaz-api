const app = require('./app');

var PORT = process.env.PORT || 4000;
app.listen(PORT, function() {
  console.log('PraxisGT API corriendo en http://localhost:' + PORT);
  console.log('Supabase: ' + process.env.SUPABASE_URL);
});
