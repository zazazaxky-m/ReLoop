import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/auth_provider.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_logo.dart';
import '../../theme/colors.dart';

class AdminShell extends StatelessWidget {
  const AdminShell({super.key, required this.child, required this.title, this.actions});

  final Widget child;
  final String title;
  final List<Widget>? actions;

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final user = auth.user;
    final location = GoRouterState.of(context).matchedLocation;
    final superadmin = user?.role == AppRole.SUPERADMIN;
    final desktopItems = superadmin ? _superadminDesktop : _adminDesktop;
    final mobileItems = superadmin ? _superadminMobile : _adminMobile;

    return LayoutBuilder(
      builder: (context, constraints) {
        final desktop = constraints.maxWidth >= 840;
        final navigation = _DesktopNavigation(
          user: user,
          items: desktopItems,
          location: location,
          onLogout: auth.logout,
          compact: constraints.maxWidth < 1160,
        );

        return Scaffold(
          appBar: AppBar(
            toolbarHeight: desktop ? 64 : 56,
            titleSpacing: 18,
            title: Row(
              children: [
                if (!desktop) ...[
                  const ReLoopLogo(compact: true, height: 30),
                  const SizedBox(width: 12),
                ],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: desktop ? 17 : 16,
                          fontWeight: FontWeight.w700,
                          letterSpacing: -0.25,
                        ),
                      ),
                      if (desktop)
                        Text(
                          user?.role.label ?? 'ReLoop',
                          style: TextStyle(
                            color: context.reloopMuted,
                            fontSize: 10.5,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            actions: [
              if (actions != null) ...actions!,
              Padding(
                padding: const EdgeInsets.only(right: 14),
                child: InkWell(
                  borderRadius: BorderRadius.circular(22),
                  onTap: () => context.push('/profile'),
                  child: CircleAvatar(
                    radius: 18,
                    backgroundColor: context.reloopBrandSoftStrong,
                    child: Text(
                      user?.name.isNotEmpty == true
                          ? user!.name[0].toUpperCase()
                          : '?',
                      style: TextStyle(
                        color: context.reloopBrandText,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
          body: Row(
            children: [
              if (desktop)
                SizedBox(
                  width: constraints.maxWidth < 1160 ? 92 : 270,
                  child: navigation,
                ),
              if (desktop)
                VerticalDivider(width: 1, color: context.reloopBorder),
              Expanded(
                child: desktop ? child : SafeArea(bottom: false, child: child),
              ),
            ],
          ),
          bottomNavigationBar: desktop
              ? null
              : _ManagementBottomBar(items: mobileItems, location: location),
        );
      },
    );
  }
}

class _ManagementBottomBar extends StatelessWidget {
  const _ManagementBottomBar({required this.items, required this.location});

  final List<_AdminNavItem> items;
  final String location;

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;
    var selected = items.indexWhere(
      (item) =>
          location == item.route ||
          (item.route != '/admin' &&
              item.route != '/superadmin' &&
              location.startsWith(item.route)),
    );
    if (selected < 0) selected = items.length - 1;

    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, bottomInset + 4),
      child: Container(
        height: 60,
        decoration: BoxDecoration(
          color: context.reloopSurfaceRaised.withValues(alpha: .98),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: context.reloopBorder),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: context.isDarkMode ? .38 : .08),
              blurRadius: 16,
              offset: const Offset(0, 6),
            ),
          ],
        ),
        child: Row(
          children: [
            for (var i = 0; i < items.length; i++)
              Expanded(
                child: _BottomItem(item: items[i], active: selected == i),
              ),
          ],
        ),
      ),
    );
  }
}

class _BottomItem extends StatelessWidget {
  const _BottomItem({required this.item, required this.active});
  final _AdminNavItem item;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: () {
        if (item.route == '__more__') {
          final isSuper = context.read<AuthProvider>().user?.role == AppRole.SUPERADMIN;
          _showMoreBottomSheet(context, isSuper);
        } else if (!active) {
          context.go(item.route);
        }
      },
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            width: active ? 42 : 36,
            height: 34,
            decoration: BoxDecoration(
              color: active ? context.reloopBrandSoft : Colors.transparent,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              item.icon,
              size: 22,
              color: active ? context.reloopBrandText : context.reloopMuted,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            item.shortLabel ?? item.label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 9.5,
              fontWeight: active ? FontWeight.w700 : FontWeight.w500,
              color: active ? context.reloopBrandText : context.reloopMuted,
            ),
          ),
        ],
      ),
    );
  }
}

class _DesktopNavigation extends StatelessWidget {
  const _DesktopNavigation({
    required this.user,
    required this.items,
    required this.location,
    required this.onLogout,
    required this.compact,
  });

  final CurrentUser? user;
  final List<_AdminNavItem> items;
  final String location;
  final VoidCallback onLogout;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: context.reloopSurface,
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(
                compact ? 22 : 20,
                18,
                compact ? 22 : 20,
                16,
              ),
              child: compact
                  ? const ReLoopLogo(compact: true, height: 40)
                  : const Align(
                      alignment: Alignment.centerLeft,
                      child: ReLoopLogo(height: 38),
                    ),
            ),
            Expanded(
              child: ListView(
                padding: EdgeInsets.symmetric(horizontal: compact ? 10 : 12),
                children: [
                  for (final item in items)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: _DesktopTile(
                        item: item,
                        compact: compact,
                        active:
                            location == item.route ||
                            (item.route != '/admin' &&
                                item.route != '/superadmin' &&
                                location.startsWith(item.route)),
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: ListTile(
                minTileHeight: 48,
                leading: Icon(
                  Icons.logout_rounded,
                  color: ReLoopColors.danger,
                  size: 20,
                ),
                title: compact
                    ? null
                    : Text(
                        'Keluar',
                        style: TextStyle(
                          color: ReLoopColors.danger,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(14),
                ),
                onTap: onLogout,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _DesktopTile extends StatelessWidget {
  const _DesktopTile({
    required this.item,
    required this.compact,
    required this.active,
  });

  final _AdminNavItem item;
  final bool compact;
  final bool active;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: compact ? item.label : '',
      child: ListTile(
        minTileHeight: 48,
        contentPadding: EdgeInsets.symmetric(
          horizontal: compact ? 12 : 14,
          vertical: 2,
        ),
        leading: Icon(
          item.icon,
          size: 20,
          color: active ? context.reloopBrandText : context.reloopMuted,
        ),
        title: compact
            ? null
            : Text(
                item.label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                  color: active
                      ? context.reloopBrandText
                      : context.reloopForeground,
                ),
              ),
        selected: active,
        selectedTileColor: context.reloopBrandSoft,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        onTap: () {
          if (!active) context.go(item.route);
        },
      ),
    );
  }
}

class _AdminNavItem {
  const _AdminNavItem(this.label, this.icon, this.route, {this.shortLabel});
  final String label;
  final IconData icon;
  final String route;
  final String? shortLabel;
}

const _adminMobile = [
  _AdminNavItem(
    'Dashboard',
    Icons.home_outlined,
    '/admin',
    shortLabel: 'Beranda',
  ),
  _AdminNavItem('Mesin', Icons.recycling_outlined, '/admin/machines'),
  _AdminNavItem('Pickup', Icons.local_shipping_outlined, '/admin/pickups'),
  _AdminNavItem('Laporan', Icons.description_outlined, '/admin/reports'),
  _AdminNavItem('Lainnya', Icons.grid_view_outlined, '__more__'),
];

const _superadminMobile = [
  _AdminNavItem(
    'Dashboard',
    Icons.home_outlined,
    '/superadmin',
    shortLabel: 'Beranda',
  ),
  _AdminNavItem(
    'Organisasi',
    Icons.business_outlined,
    '/superadmin/organizations',
    shortLabel: 'Org',
  ),
  _AdminNavItem('Mesin', Icons.recycling_outlined, '/superadmin/machines'),
  _AdminNavItem('Keamanan', Icons.shield_outlined, '/superadmin/security'),
  _AdminNavItem('Lainnya', Icons.grid_view_outlined, '__more__'),
];

void _showMoreBottomSheet(BuildContext context, bool isSuper) {
  final location = GoRouterState.of(context).matchedLocation;
  
  final items = isSuper
      ? const [
          _AdminNavItem('Pengguna', Icons.people_outline, '/superadmin/users'),
          _AdminNavItem('Kemitraan', Icons.handshake_outlined, '/superadmin/partnerships'),
          _AdminNavItem('Redemption', Icons.account_balance_wallet_outlined, '/superadmin/redemptions'),
          _AdminNavItem('Wilayah', Icons.public_outlined, '/superadmin/regions'),
          _AdminNavItem('Jenis & Tarif', Icons.delete_outline, '/superadmin/waste-types'),
          _AdminNavItem('Konfigurasi', Icons.settings_outlined, '/superadmin/config'),
          _AdminNavItem('Audit Log', Icons.history_rounded, '/superadmin/audit'),
          _AdminNavItem('Laporan', Icons.description_outlined, '/superadmin/reports'),
          _AdminNavItem('Profil', Icons.person_outline_rounded, '/profile'),
        ]
      : const [
          _AdminNavItem('Campaign', Icons.campaign_outlined, '/admin/campaigns'),
          _AdminNavItem('Jenis & Tarif', Icons.delete_outline, '/admin/waste-types'),
          _AdminNavItem('Mitra Pengepul', Icons.handshake_outlined, '/admin/partners'),
          _AdminNavItem('Trip / Trash Bag', Icons.luggage_outlined, '/admin/trips'),
          _AdminNavItem('Profil', Icons.person_outline_rounded, '/profile'),
        ];

  showModalBottomSheet(
    context: context,
    backgroundColor: context.reloopSurfaceRaised,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (ctx) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Align(
                alignment: Alignment.center,
                child: Container(
                  width: 38,
                  height: 4,
                  decoration: BoxDecoration(
                    color: ctx.reloopBorder,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Menu Administrasi',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: ctx.reloopForeground,
                ),
              ),
              const SizedBox(height: 16),
              Flexible(
                child: GridView.builder(
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 3,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    childAspectRatio: 0.95,
                  ),
                  itemCount: items.length,
                  itemBuilder: (context, index) {
                    final item = items[index];
                    final active = location == item.route ||
                        (item.route != '/profile' && location.startsWith(item.route));
                    final color = active ? ctx.reloopBrandText : ctx.reloopMuted;
                    
                    return InkWell(
                      borderRadius: BorderRadius.circular(16),
                      onTap: () {
                        Navigator.pop(ctx);
                        ctx.go(item.route);
                      },
                      child: Container(
                        decoration: BoxDecoration(
                          color: active ? ctx.reloopBrandSoft : Colors.transparent,
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(
                            color: active ? ctx.reloopBrandSoftStrong : Colors.transparent,
                          ),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(item.icon, size: 24, color: color),
                            const SizedBox(height: 8),
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 4),
                              child: Text(
                                item.label,
                                textAlign: TextAlign.center,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                                  color: color,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      );
    },
  );
}

const _adminDesktop = [
  _AdminNavItem('Dashboard', Icons.space_dashboard_outlined, '/admin'),
  _AdminNavItem('Mesin', Icons.recycling_outlined, '/admin/machines'),
  _AdminNavItem('Pickup', Icons.local_shipping_outlined, '/admin/pickups'),
  _AdminNavItem('Campaign', Icons.campaign_outlined, '/admin/campaigns'),
  _AdminNavItem(
    'Jenis Sampah & Tarif',
    Icons.delete_outline,
    '/admin/waste-types',
  ),
  _AdminNavItem('Mitra Pengepul', Icons.handshake_outlined, '/admin/partners'),
  _AdminNavItem('Trip / Trash Bag', Icons.luggage_outlined, '/admin/trips'),
  _AdminNavItem('Laporan', Icons.description_outlined, '/admin/reports'),
  _AdminNavItem('Profil', Icons.person_outline_rounded, '/profile'),
];

const _superadminDesktop = [
  _AdminNavItem('Dashboard', Icons.space_dashboard_outlined, '/superadmin'),
  _AdminNavItem(
    'Organisasi',
    Icons.business_outlined,
    '/superadmin/organizations',
  ),
  _AdminNavItem('Mesin', Icons.recycling_outlined, '/superadmin/machines'),
  _AdminNavItem('Pengguna', Icons.people_outline, '/superadmin/users'),
  _AdminNavItem(
    'Kemitraan',
    Icons.handshake_outlined,
    '/superadmin/partnerships',
  ),
  _AdminNavItem(
    'Redemption',
    Icons.account_balance_wallet_outlined,
    '/superadmin/redemptions',
  ),
  _AdminNavItem('Log Keamanan', Icons.shield_outlined, '/superadmin/security'),
  _AdminNavItem('Wilayah', Icons.public_outlined, '/superadmin/regions'),
  _AdminNavItem(
    'Jenis Sampah & Tarif',
    Icons.delete_outline,
    '/superadmin/waste-types',
  ),
  _AdminNavItem('Konfigurasi', Icons.settings_outlined, '/superadmin/config'),
  _AdminNavItem('Audit Log', Icons.history_rounded, '/superadmin/audit'),
  _AdminNavItem('Laporan', Icons.description_outlined, '/superadmin/reports'),
  _AdminNavItem('Profil', Icons.person_outline_rounded, '/profile'),
];
