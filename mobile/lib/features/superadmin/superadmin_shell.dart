import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../../core/auth_provider.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_logo.dart';
import '../../theme/colors.dart';

class SuperadminShell extends StatelessWidget {
  final Widget child;
  final String title;

  const SuperadminShell({super.key, required this.child, required this.title});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    final location = GoRouterState.of(context).matchedLocation;
    final isDark = Theme.of(context).brightness == Brightness.dark;

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
            IconButton(
              icon: const Icon(Icons.logout, size: 20),
              tooltip: 'Keluar',
              onPressed: () => auth.logout(),
            ),
          const SizedBox(width: 8),
        ],
      ),
      drawer: Drawer(
        child: SafeArea(
          child: Column(
            children: [
              _buildHeader(user, isDark),
              const Divider(height: 1),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  children: _buildNavItems(context, user, location, isDark),
                ),
              ),
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  'ReLoop v1.0 — Superadmin',
                  style: TextStyle(fontSize: 11, color: isDark ? ReLoopColors.mutedSoftDark : ReLoopColors.mutedSoft),
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        ),
      ),
      body: child,
    );
  }

  Widget _buildHeader(CurrentUser? user, bool isDark) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      color: isDark ? ReLoopColors.surfaceDark : ReLoopColors.surface,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const ReLoopLogo(compact: true, height: 36),
          const SizedBox(height: 12),
          if (user != null) ...[
            Row(
              children: [
                CircleAvatar(
                  radius: 20,
                  backgroundColor: ReLoopColors.brand100,
                  child: Text(
                    user.name.isNotEmpty ? user.name[0].toUpperCase() : 'SA',
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: 16,
                      color: ReLoopColors.brand700,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        user.name,
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                          color: isDark ? ReLoopColors.foregroundDark : ReLoopColors.foreground,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        user.email,
                        style: TextStyle(
                          fontSize: 12,
                          color: isDark ? ReLoopColors.mutedSoftDark : ReLoopColors.mutedSoft,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  List<Widget> _buildNavItems(
    BuildContext context,
    CurrentUser? user,
    String location,
    bool isDark,
  ) {
    final sections = [
      _NavSection('Utama', [
        _NavItem('Dashboard', Icons.dashboard_outlined, '/superadmin'),
        _NavItem('Organisasi', Icons.business_outlined, '/superadmin/organizations'),
        _NavItem('Pengguna', Icons.people_outlined, '/superadmin/users'),
        _NavItem('Mesin', Icons.recycling_outlined, '/superadmin/machines'),
      ]),
      _NavSection('Operasional', [
        _NavItem('Kemitraan', Icons.handshake_outlined, '/superadmin/partnerships'),
        _NavItem('Redemption', Icons.account_balance_wallet_outlined, '/superadmin/redemptions'),
        _NavItem('Wilayah', Icons.public_outlined, '/superadmin/regions'),
        _NavItem('Jenis & Tarif', Icons.delete_outline, '/superadmin/waste-types'),
        _NavItem('Trip / Trash Bag', Icons.luggage_outlined, '/superadmin/trips'),
      ]),
      _NavSection('Sistem', [
        _NavItem('Keamanan & Audit', Icons.security_outlined, '/superadmin/audit'),
        _NavItem('Konfigurasi', Icons.settings_outlined, '/superadmin/config'),
        _NavItem('Laporan', Icons.description_outlined, '/superadmin/reports'),
      ]),
      _NavSection('Akun', [
        _NavItem('Profil', Icons.person_outline, '/profile'),
      ]),
    ];

    final activeColor = ReLoopColors.brand600;
    final activeBg = isDark ? ReLoopColors.brand700.withValues(alpha: 0.15) : ReLoopColors.brand50;

    final widgets = <Widget>[];
    for (final section in sections) {
      widgets.add(
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
          child: Text(
            section.label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.5,
              color: isDark ? ReLoopColors.mutedSoftDark : ReLoopColors.mutedSoft,
            ),
          ),
        ),
      );
      for (final item in section.items) {
        final isActive = location == item.route ||
            (item.route != '/superadmin' && location.startsWith(item.route));
        widgets.add(
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
            child: ListTile(
              leading: Icon(
                item.icon,
                color: isActive ? activeColor : (isDark ? ReLoopColors.mutedSoftDark : ReLoopColors.mutedSoft),
                size: 20,
              ),
              title: Text(
                item.label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
                  color: isActive
                      ? activeColor
                      : (isDark ? ReLoopColors.foregroundDark : ReLoopColors.foreground),
                ),
              ),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              selected: isActive,
              selectedTileColor: activeBg,
              dense: true,
              onTap: () {
                Navigator.pop(context);
                if (location != item.route) {
                  context.go(item.route);
                }
              },
            ),
          ),
        );
      }
    }
    return widgets;
  }
}

class _NavSection {
  final String label;
  final List<_NavItem> items;
  const _NavSection(this.label, this.items);
}

class _NavItem {
  final String label;
  final IconData icon;
  final String route;
  const _NavItem(this.label, this.icon, this.route);
}
