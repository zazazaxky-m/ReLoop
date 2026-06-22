import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/auth_provider.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_logo.dart';
import '../../theme/colors.dart';

class AdminShell extends StatelessWidget {
  final Widget child;
  final String title;

  const AdminShell({super.key, required this.child, required this.title});

  static const _navItems = <_AdminNavItem>[
    _AdminNavItem('Dashboard', Icons.dashboard_outlined, '/admin'),
    _AdminNavItem('Mesin', Icons.recycling_outlined, '/admin/machines'),
    _AdminNavItem('Pickup', Icons.local_shipping_outlined, '/admin/pickups'),
    _AdminNavItem('Campaign', Icons.campaign_outlined, '/admin/campaigns'),
    _AdminNavItem('Jenis Sampah & Tarif', Icons.delete_outline, '/admin/waste-types'),
    _AdminNavItem('Mitra Pengepul', Icons.handshake_outlined, '/admin/partners'),
    _AdminNavItem('Trip / Trash Bag', Icons.luggage_outlined, '/admin/trips'),
    _AdminNavItem('Laporan', Icons.description_outlined, '/admin/reports'),
    _AdminNavItem('Profil', Icons.person_outline, '/profile'),
  ];

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    final location = GoRouterState.of(context).matchedLocation;

    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        leading: Builder(
          builder: (ctx) => IconButton(
            icon: const Icon(Icons.menu),
            onPressed: () => Scaffold.of(ctx).openDrawer(),
          ),
        ),
        actions: [
          if (user != null)
            Padding(
              padding: const EdgeInsets.only(right: 8),
              child: IconButton(
                icon: const Icon(Icons.logout, size: 20),
                tooltip: 'Keluar',
                onPressed: () => auth.logout(),
              ),
            ),
        ],
      ),
      drawer: Drawer(
        child: SafeArea(
          child: Column(
            children: [
              DrawerHeader(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const ReLoopLogo(compact: true, height: 40),
                    const SizedBox(height: 12),
                    if (user != null) ...[
                      Text(
                        user.name,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                          color: ReLoopColors.foreground,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        user.email,
                        style: const TextStyle(
                          fontSize: 12,
                          color: ReLoopColors.mutedSoft,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: ReLoopColors.brand50,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          user.role.label,
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: ReLoopColors.brand600,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  children: _navItems.map((item) {
                    final isActive = location == item.route ||
                        (item.route != '/admin' &&
                            location.startsWith(item.route));
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 2),
                      child: ListTile(
                        leading: Icon(
                          item.icon,
                          color: isActive
                              ? ReLoopColors.brand600
                              : ReLoopColors.mutedSoft,
                          size: 20,
                        ),
                        title: Text(
                          item.label,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight:
                                isActive ? FontWeight.w600 : FontWeight.normal,
                            color: isActive
                                ? ReLoopColors.brand600
                                : ReLoopColors.foreground,
                          ),
                        ),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                        selected: isActive,
                        selectedTileColor: ReLoopColors.brand50,
                        dense: true,
                        onTap: () {
                          Navigator.pop(context);
                          if (location != item.route) {
                            context.go(item.route);
                          }
                        },
                      ),
                    );
                  }).toList(),
                ),
              ),
            ],
          ),
        ),
      ),
      body: child,
    );
  }
}

class _AdminNavItem {
  final String label;
  final IconData icon;
  final String route;
  const _AdminNavItem(this.label, this.icon, this.route);
}
