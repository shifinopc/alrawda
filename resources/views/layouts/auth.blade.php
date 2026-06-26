<!doctype html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="csrf-token" content="{{ csrf_token() }}">
    <title>Login – {{ config('app.name', 'Billing') }}</title>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@300;400;500;600;700&display=swap" rel="stylesheet">

    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            fontFamily: {
              sans: ["Bricolage Grotesque", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
            },
            borderRadius: { xl: "16px" },
            colors: {
              brand: {
                50: "#eef2ff", 100: "#e0e7ff", 200: "#c7d2fe", 300: "#a5b4fc",
                400: "#818cf8", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca",
                800: "#3730a3", 900: "#312e81",
              },
            },
          },
        },
      };
    </script>
    <link rel="stylesheet" href="{{ asset('css/app.css') }}">
  </head>
  <body class="min-h-screen bg-slate-50 text-slate-900 antialiased">
    @yield('content')
  </body>
</html>
