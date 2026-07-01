import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../../core/auth_provider.dart';
import '../../core/models.dart';
import '../../shared/widgets/reloop_logo.dart';
import '../../theme/colors.dart';

class AdminShell extends StatelessWidget {
  const AdminShell({
    super.key,
    required this.child,
    required this.title,
    this.actions,
  });

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

        final showAppBar =
            desktop || (location != '/admin' && location != '/scan');

        return Scaffold(
          appBar: showAppBar
              ? AppBar(
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
                    ...?actions,
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
                )
              : null,
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
              color: Colors.black.withValues(
                alpha: context.isDarkMode ? .38 : .08,
              ),
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
    final primary = item.route == '/scan';
    final color = active ? context.reloopBrandText : context.reloopMuted;
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: () {
        if (item.route == '__more__') {
          final isSuper =
              context.read<AuthProvider>().user?.role == AppRole.SUPERADMIN;
          showAdminMoreBottomSheet(context, isSuper);
        } else if (!active) {
          context.go(item.route);
        }
      },
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            width: primary ? 44 : (active ? 42 : 36),
            height: primary ? 39 : 34,
            decoration: BoxDecoration(
              color: primary
                  ? ReLoopColors.brand600
                  : active
                  ? context.reloopBrandSoft
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(primary ? 13 : 12),
              boxShadow: primary
                  ? const [
                      BoxShadow(
                        color: Color(0x28249A4D),
                        blurRadius: 12,
                        offset: Offset(0, 4),
                      ),
                    ]
                  : null,
            ),
            child: Icon(
              item.icon,
              size: primary ? 24 : 22,
              color: primary ? Colors.white : color,
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
              color: color,
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
  _AdminNavItem('Scan', Icons.qr_code_scanner_outlined, '/scan'),
  _AdminNavItem('Pickup', Icons.local_shipping_outlined, '/admin/pickups'),
  _AdminNavItem('Profil', Icons.person_outline_rounded, '/profile'),
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

void showAdminMoreBottomSheet(BuildContext context, bool isSuper) {
  final location = GoRouterState.of(context).matchedLocation;

  final topItems = isSuper
      ? const [
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
          _AdminNavItem(
            'Wilayah',
            Icons.public_outlined,
            '/superadmin/regions',
          ),
          _AdminNavItem(
            'Jenis & Tarif',
            Icons.delete_outline,
            '/superadmin/waste-types',
          ),
          _AdminNavItem(
            'Konfigurasi',
            Icons.settings_outlined,
            '/superadmin/config',
          ),
          _AdminNavItem(
            'Audit Log',
            Icons.history_rounded,
            '/superadmin/audit',
          ),
          _AdminNavItem(
            'Laporan',
            Icons.description_outlined,
            '/superadmin/reports',
          ),
          _AdminNavItem('Profil', Icons.person_outline_rounded, '/profile'),
        ]
      : const [
          _AdminNavItem(
            'Campaign',
            Icons.campaign_outlined,
            '/admin/campaigns',
          ),
          _AdminNavItem(
            'Jenis & Tarif',
            Icons.delete_outline,
            '/admin/waste-types',
          ),
          _AdminNavItem(
            'Mitra Pengepul',
            Icons.handshake_outlined,
            '/admin/partners',
          ),
          _AdminNavItem(
            'Trip / Trash Bag',
            Icons.luggage_outlined,
            '/admin/trips',
          ),
          _AdminNavItem(
            'Travel Agent',
            Icons.badge_outlined,
            '/admin/travel-agents',
          ),
          _AdminNavItem(
            'Compliance',
            Icons.fact_check_outlined,
            '/admin/compliance',
          ),
          _AdminNavItem('Profil', Icons.person_outline_rounded, '/profile'),
        ];
  final sections = isSuper
      ? const [
          _AdminMenuSection('Pengelolaan', [
            _AdminNavItem(
              'Organisasi',
              Icons.business_outlined,
              '/superadmin/organizations',
            ),
            _AdminNavItem(
              'Pengguna',
              Icons.people_outline,
              '/superadmin/users',
            ),
            _AdminNavItem(
              'Wilayah',
              Icons.public_outlined,
              '/superadmin/regions',
            ),
          ]),
          _AdminMenuSection('Operasional', [
            _AdminNavItem(
              'Mesin',
              Icons.recycling_outlined,
              '/superadmin/machines',
            ),
            _AdminNavItem(
              'Jenis & Tarif',
              Icons.delete_outline,
              '/superadmin/waste-types',
            ),
            _AdminNavItem(
              'Kemitraan',
              Icons.handshake_outlined,
              '/superadmin/partnerships',
            ),
          ]),
          _AdminMenuSection('Monitoring', [
            _AdminNavItem(
              'Keamanan',
              Icons.shield_outlined,
              '/superadmin/security',
            ),
            _AdminNavItem(
              'Audit Log',
              Icons.history_rounded,
              '/superadmin/audit',
            ),
            _AdminNavItem(
              'Laporan',
              Icons.description_outlined,
              '/superadmin/reports',
            ),
            _AdminNavItem(
              'Konfigurasi',
              Icons.settings_outlined,
              '/superadmin/config',
            ),
          ]),
        ]
      : const [
          _AdminMenuSection('Operasional', [
            _AdminNavItem('Mesin', Icons.recycling_outlined, '/admin/machines'),
            _AdminNavItem(
              'Pickup',
              Icons.local_shipping_outlined,
              '/admin/pickups',
            ),
            _AdminNavItem(
              'Campaign',
              Icons.campaign_outlined,
              '/admin/campaigns',
            ),
            _AdminNavItem(
              'Trip / Trash Bag',
              Icons.luggage_outlined,
              '/admin/trips',
            ),
          ]),
          _AdminMenuSection('Relasi & Data', [
            _AdminNavItem(
              'Jenis & Tarif',
              Icons.delete_outline,
              '/admin/waste-types',
            ),
            _AdminNavItem(
              'Mitra Pengepul',
              Icons.handshake_outlined,
              '/admin/partners',
            ),
            _AdminNavItem(
              'Travel Agent',
              Icons.badge_outlined,
              '/admin/travel-agents',
            ),
          ]),
          _AdminMenuSection('Monitoring', [
            _AdminNavItem(
              'Compliance',
              Icons.fact_check_outlined,
              '/admin/compliance',
            ),
            _AdminNavItem(
              'Laporan',
              Icons.description_outlined,
              '/admin/reports',
            ),
            _AdminNavItem('Profil', Icons.person_outline_rounded, '/profile'),
          ]),
        ];

  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.reloopSurfaceRaised,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (ctx) {
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 20),
          child: ListView(
            shrinkWrap: true,
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
                'Layanan teratas',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: ctx.reloopForeground,
                ),
              ),
              const SizedBox(height: 16),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 4,
                  crossAxisSpacing: 10,
                  mainAxisSpacing: 12,
                  childAspectRatio: .82,
                ),
                itemCount: topItems.length,
                itemBuilder: (context, index) {
                  final item = topItems[index];
                  final active =
                      location == item.route ||
                      (item.route != '/profile' &&
                          item.route != '/admin' &&
                          item.route != '/superadmin' &&
                          location.startsWith(item.route));
                  final color = active ? ctx.reloopBrandText : ctx.reloopMuted;

                  return InkWell(
                    borderRadius: BorderRadius.circular(18),
                    onTap: () {
                      Navigator.pop(ctx);
                      ctx.go(item.route);
                    },
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          width: 58,
                          height: 58,
                          decoration: BoxDecoration(
                            color: active
                                ? ctx.reloopBrandSoft
                                : ctx.reloopSurface,
                            borderRadius: BorderRadius.circular(18),
                            border: Border.all(color: ctx.reloopBorder),
                          ),
                          child: Icon(item.icon, size: 27, color: color),
                        ),
                        const SizedBox(height: 7),
                        Text(
                          item.shortLabel ?? item.label,
                          textAlign: TextAlign.center,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 11,
                            height: 1.1,
                            fontWeight: active
                                ? FontWeight.w800
                                : FontWeight.w600,
                            color: active
                                ? ctx.reloopBrandText
                                : ctx.reloopForeground,
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
              const SizedBox(height: 22),
              Text(
                'Layanan lainnya',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: ctx.reloopForeground,
                ),
              ),
              const SizedBox(height: 14),
              for (final section in sections) ...[
                Text(
                  section.title,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: ctx.reloopForeground,
                  ),
                ),
                const SizedBox(height: 8),
                for (final item in section.items)
                  _MoreServiceTile(
                    item: item,
                    active:
                        location == item.route ||
                        (item.route != '/profile' &&
                            item.route != '/admin' &&
                            item.route != '/superadmin' &&
                            location.startsWith(item.route)),
                    onTap: () {
                      Navigator.pop(ctx);
                      ctx.go(item.route);
                    },
                  ),
                const SizedBox(height: 14),
              ],
            ],
          ),
        ),
      );
    },
  );
}

class _AdminMenuSection {
  const _AdminMenuSection(this.title, this.items);
  final String title;
  final List<_AdminNavItem> items;
}

class _MoreServiceTile extends StatelessWidget {
  const _MoreServiceTile({
    required this.item,
    required this.active,
    required this.onTap,
  });

  final _AdminNavItem item;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = active ? context.reloopBrandText : context.reloopMuted;
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Row(
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: active ? context.reloopBrandSoft : context.reloopSurface,
                borderRadius: BorderRadius.circular(15),
              ),
              child: Icon(item.icon, color: color, size: 23),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: context.reloopForeground,
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _serviceDescription(item.route),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: context.reloopMuted,
                      fontSize: 11.5,
                    ),
                  ),
                ],
              ),
            ),
            Icon(Icons.chevron_right_rounded, color: context.reloopMutedSoft),
          ],
        ),
      ),
    );
  }
}

String _serviceDescription(String route) {
  if (route.contains('machines')) return 'Pantau mesin dan kapasitas';
  if (route.contains('pickups')) return 'Kelola permintaan pengambilan';
  if (route.contains('campaigns')) return 'Atur program dan reward';
  if (route.contains('waste-types')) {
    return 'Kelola organik, anorganik, dan tarif';
  }
  if (route.contains('partners') || route.contains('partnerships')) {
    return 'Kelola mitra pengepul';
  }
  if (route.contains('trips')) return 'Kelola trip dan QR trash bag';
  if (route.contains('travel-agents')) return 'Invite dan pantau travel agent';
  if (route.contains('compliance')) return 'Pantau kepatuhan rombongan';
  if (route.contains('reports')) return 'Unduh dan cek laporan';
  if (route.contains('users')) return 'Kelola akun pengguna';
  if (route.contains('organizations')) return 'Kelola organisasi tenant';
  if (route.contains('regions')) return 'Kelola wilayah layanan';
  if (route.contains('security')) return 'Pantau keamanan sistem';
  if (route.contains('config')) return 'Atur konfigurasi global';
  if (route.contains('audit')) return 'Lihat jejak audit';
  if (route == '/profile') return 'Pengaturan akun';
  return 'Buka layanan administrasi';
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
  _AdminNavItem('Travel Agent', Icons.badge_outlined, '/admin/travel-agents'),
  _AdminNavItem('Compliance', Icons.fact_check_outlined, '/admin/compliance'),
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
