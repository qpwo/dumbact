eg

the 'react without a build step' things were many many megabytes so i made thess

<!doctype html>
<html>
<body>
  <main id="app"></main>
  <script src="./dumbact.js"></script>
  <script type="text/dumbact-tsx">
    const App = () => (
      <button onClick={() => Dumbact.set('example:count', n => (n || 0) + 1)}>
        Count: {Dumbact.get('example:count', 0)}
      </button>
    );
    Dumbact.render(App, '#app');
  </script>
</body>
</html>
