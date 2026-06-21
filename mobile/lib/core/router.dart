import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../core/auth_provider.dart';
import '../core/models.dart';
import '../features/auth/login_screen.dart';
import '../features/auth/register_screen.dart';
import '../features/dashboard/user_dashboard_screen.dart';
import '../features/scan/scan_screen.dart';
import '../features/wallet/wallet_screen.dart';
import '../features/wallet/redemption_screen.dart';
import '../features/wallet/payout_account_form.dart';
import '../features/map/map_screen.dart';
import '../features/campaigns/campaigns_screen.dart';
import '../features/pickup/pickup_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/trash_bag/trash_bag_screen.dart';
import '../features/trash_bag/trash_bag_form.dart';
import '../features/trash_bag/trash_bag_history.dart';
import '../features/machine/machine_detail_screen.dart';
import '../features/pengepul/area_map_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../services/notification_service.dart';
import '../services/analytics_service.dart';

class AppRouter {
  final AuthProvider authProvider;
  final NotificationService _notifService;
  final AnalyticsService _analytics;

  AppRouter(this.authProvider, this._notifService, {AnalyticsService? analytics})
      : _analytics = analytics ?? AnalyticsService() {
    _notifService.onNotificationTap = _handleNotificationTap;
  }

  void _handleNotificationTap(String route, Map<String, String>? params) {
    final currentRoute = router.routerDelegate.currentConfiguration.uri.path;
    if (currentRoute == route) return;
    if (params != null && params.isNotEmpty) {
      final uri = Uri(path: route, queryParameters: params);
      router.go(uri.toString());
    } else {
      router.go(route);
    }
  }

  void _trackScreenView(String? location) {
    if (location == null) return;
    final name = _screenNameMap[location] ?? location;
    _analytics.logScreenView(screenName: name);
  }

  static const _screenNameMap = {
    '/login': 'Login',
    '/register': 'Register',
    '/dashboard': 'Dashboard',
    '/scan': 'Scan',
    '/wallet': 'Wallet',
    '/wallet/redemption': 'Redemption',
    '/map': 'Map',
    '/campaigns': 'Campaigns',
    '/pickup': 'Pickup',
    '/profile': 'Profile',
    '/trash-bags': 'Trash Bag',
    '/trash-bags/create': 'Trash Bag Form',
    '/trash-bags/history': 'Trash Bag History',
  };

  late final router = GoRouter(
    refreshListenable: authProvider,
    initialLocation: '/splash',
    routes: [
      GoRoute(
        path: '/splash',
        builder: (context, state) => const _SplashScreen(),
      ),
      GoRoute(
        path: '/onboarding',
        builder: (context, state) => const OnboardingScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegisterScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => _AppScaffold(child: child),
        routes: [
          GoRoute(
            path: '/dashboard',
            builder: (context, state) => const UserDashboardScreen(),
          ),
          GoRoute(
            path: '/scan',
            builder: (context, state) => const ScanScreen(),
          ),
          GoRoute(
            path: '/wallet',
            builder: (context, state) => const WalletScreen(),
          ),
          GoRoute(
            path: '/map',
            builder: (context, state) => const MapScreen(),
          ),
          GoRoute(
            path: '/campaigns',
            builder: (context, state) => const CampaignsScreen(),
          ),
          GoRoute(
            path: '/pickup',
            builder: (context, state) => const PickupScreen(),
          ),
          GoRoute(
            path: '/profile',
            builder: (context, state) => const ProfileScreen(),
          ),
          GoRoute(
            path: '/wallet/redemption',
            builder: (context, state) => const RedemptionScreen(),
          ),
          GoRoute(
            path: '/wallet/redemption/create',
            builder: (context, state) => const PayoutAccountForm(),
          ),
          GoRoute(
            path: '/wallet/add-account',
            builder: (context, state) => const PayoutAccountForm(),
          ),
          GoRoute(
            path: '/trash-bags',
            builder: (context, state) => const TrashBagScreen(),
          ),
          GoRoute(
            path: '/trash-bags/create',
            builder: (context, state) => const TrashBagForm(),
          ),
          GoRoute(
            path: '/trash-bags/history',
            builder: (context, state) => const TrashBagHistory(),
          ),
          GoRoute(
            path: '/machine/:code/detail',
            builder: (context, state) {
              final code = state.pathParameters['code']!;
              return MachineDetailScreen(machineCode: code);
            },
          ),
          GoRoute(
            path: '/pengepul/area',
            builder: (context, state) => const AreaMapScreen(),
          ),
        ],
      ),
    ],
    redirect: (context, state) {
      final location = state.matchedLocation;
      _trackScreenView(location);
      final isAuthenticated = authProvider.isAuthenticated;
      final isAuthRoute = location == '/login' ||
          location == '/register';
      final isSplash = location == '/splash';

      if (isSplash) return null;
      if (!isAuthenticated && !isAuthRoute) {
        return '/login?redirect=${Uri.encodeComponent(location)}';
      }
      if (isAuthenticated && isAuthRoute) {
        final redirect = state.uri.queryParameters['redirect'];
        if (redirect != null) return redirect;
        return authProvider.dashboardRoute;
      }
      return null;
    },
  );
}

class _SplashScreen extends StatefulWidget {
  const _SplashScreen();

  @override
  State<_SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<_SplashScreen> {
  @override
  void initState() {
    super.initState();
    _checkAuth();
  }

  Future<void> _checkAuth() async {
    final auth = context.read<AuthProvider>();
    await auth.checkSession();

    final storage = const FlutterSecureStorage();
    final onboardingDone = await storage.read(key: 'onboarding_completed');

    if (!mounted) return;
    if (onboardingDone != 'true') {
      context.go('/onboarding');
    } else if (auth.isAuthenticated) {
      context.go(auth.dashboardRoute);
    } else {
      context.go('/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF16A34A),
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.recycling, size: 64, color: Colors.white),
            const SizedBox(height: 16),
            Text(
              'ReLoop',
              style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
            ),
            const SizedBox(height: 24),
            const CircularProgressIndicator(color: Colors.white),
          ],
        ),
      ),
    );
  }
}

class _AppScaffold extends StatelessWidget {
  final Widget child;

  const _AppScaffold({required this.child});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final location = GoRouterState.of(context).matchedLocation;

    int currentIndex = 0;
    if (location.startsWith('/scan')) {
      currentIndex = 1;
    } else if (location.startsWith('/wallet')) {
      currentIndex = 2;
    } else if (location.startsWith('/map')) {
      currentIndex = 3;
    } else if (location.startsWith('/campaigns')) {
      currentIndex = 4;
    } else if (location.startsWith('/pickup')) {
      currentIndex = 0;
    }

    final isCollector = auth.user?.role == AppRole.PENGEPUL;
    final isAdmin = auth.user?.role == AppRole.ADMIN ||
        auth.user?.role == AppRole.SUPERADMIN;

    if (isAdmin) {
      return child;
    }

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: currentIndex,
        onDestinationSelected: (index) {
          switch (index) {
            case 0:
              context.go(isCollector ? '/pickup' : '/dashboard');
            case 1:
              context.go('/scan');
            case 2:
              context.go('/wallet');
            case 3:
              context.go('/map');
            case 4:
              context.go('/campaigns');
          }
        },
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.dashboard_outlined),
            selectedIcon: const Icon(Icons.dashboard_rounded),
            label: isCollector ? 'Tugas' : 'Beranda',
          ),
          const NavigationDestination(
            icon: Icon(Icons.qr_code_scanner_outlined),
            selectedIcon: Icon(Icons.qr_code_scanner),
            label: 'Scan',
          ),
          const NavigationDestination(
            icon: Icon(Icons.account_balance_wallet_outlined),
            selectedIcon: Icon(Icons.account_balance_wallet),
            label: 'Dompet',
          ),
          const NavigationDestination(
            icon: Icon(Icons.map_outlined),
            selectedIcon: Icon(Icons.map),
            label: 'Peta',
          ),
          const NavigationDestination(
            icon: Icon(Icons.campaign_outlined),
            selectedIcon: Icon(Icons.campaign),
            label: 'Program',
          ),
        ],
      ),
    );
  }
}
