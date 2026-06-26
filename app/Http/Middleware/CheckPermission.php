<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class CheckPermission
{
    public function handle(Request $request, Closure $next, string $resource, string $action): Response
    {
        $user = $request->user();
        if (! $user) {
            return redirect()->route('login');
        }
        if ($user->isAdmin()) {
            return $next($request);
        }
        if (! $user->canAccess($resource, $action)) {
            abort(403, 'You do not have permission to perform this action.');
        }
        return $next($request);
    }
}
