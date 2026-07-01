import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// Kumpulan transisi halaman yang dipakai di seluruh router.
///
/// Tujuannya agar perpindahan antar layar terasa lebih natural & tidak monoton
/// (tidak semua "slide dari kanan"). Setiap kategori punya karakter sendiri:
///
/// - [fadePage]         untuk perpindahan tab (instant, no slide)
/// - [slideRightPage]   untuk push detail (default, iOS-style)
/// - [modalBottomPage]  untuk modal (slide dari bawah)
/// - [authFadePage]     untuk login/register (fade + scale halus)
/// - [buildPage]        router helper yang memilih transisi otomatis
///                       berdasarkan path layar.

const _kBaseDuration = Duration(milliseconds: 220);
const _kModalDuration = Duration(milliseconds: 320);

const _authPaths = <String>{
  '/login',
  '/register',
  '/onboarding',
  '/forgot-password',
  '/splash',
  '/about',
  '/terms',
  '/privacy',
};

const _modalPaths = <String>{
  '/wallet/redemption',
  '/wallet/redemption/create',
  '/wallet/add-account',
};

const _tabPaths = <String>{
  '/dashboard',
  '/pengepul/dashboard',
  '/scan',
  '/wallet',
  '/map',
  '/campaigns',
  '/pickup',
  '/pengepul/tourism-pickups',
  '/pengepul/area',
  '/profile',
  '/admin',
  '/superadmin',
  '/trash-bags',
};

enum PageStyle { fade, slideRight, modalBottom, authFade }

PageStyle styleForPath(String location) {
  if (_authPaths.contains(location)) return PageStyle.authFade;
  if (_modalPaths.contains(location)) return PageStyle.modalBottom;
  if (_tabPaths.contains(location)) return PageStyle.fade;
  return PageStyle.slideRight;
}

/// Mengkonversi child ke CustomTransitionPage dengan transisi sesuai [style].
CustomTransitionPage<T> buildPage<T>({
  required LocalKey key,
  required Widget child,
  required PageStyle style,
  Duration? duration,
}) {
  final d = duration ?? (style == PageStyle.modalBottom ? _kModalDuration : _kBaseDuration);
  switch (style) {
    case PageStyle.fade:
      return CustomTransitionPage<T>(
        key: key,
        child: child,
        transitionDuration: d,
        reverseTransitionDuration: d,
        transitionsBuilder: (_, animation, _, child) =>
            FadeTransition(opacity: animation, child: child),
      );
    case PageStyle.authFade:
      return CustomTransitionPage<T>(
        key: key,
        child: child,
        transitionDuration: d,
        reverseTransitionDuration: d,
        transitionsBuilder: (_, animation, _, child) {
          final curved = CurvedAnimation(
            parent: animation,
            curve: Curves.easeOutCubic,
            reverseCurve: Curves.easeInCubic,
          );
          return FadeTransition(
            opacity: curved,
            child: ScaleTransition(
              scale: Tween<double>(begin: .96, end: 1).animate(curved),
              child: child,
            ),
          );
        },
      );
    case PageStyle.slideRight:
      return CustomTransitionPage<T>(
        key: key,
        child: child,
        transitionDuration: d,
        reverseTransitionDuration: d,
        transitionsBuilder: (_, animation, _, child) {
          final curved = CurvedAnimation(
            parent: animation,
            curve: Curves.easeOutCubic,
            reverseCurve: Curves.easeInCubic,
          );
          final slide = Tween<Offset>(
            begin: const Offset(.12, 0),
            end: Offset.zero,
          ).animate(curved);
          return SlideTransition(
            position: slide,
            child: FadeTransition(
              opacity: Tween<double>(begin: 0, end: 1).animate(curved),
              child: child,
            ),
          );
        },
      );
    case PageStyle.modalBottom:
      return CustomTransitionPage<T>(
        key: key,
        child: child,
        transitionDuration: d,
        reverseTransitionDuration: d,
        fullscreenDialog: true,
        transitionsBuilder: (_, animation, _, child) {
          final curved = CurvedAnimation(
            parent: animation,
            curve: Curves.easeOutCubic,
            reverseCurve: Curves.easeInCubic,
          );
          return SlideTransition(
            position: Tween<Offset>(
              begin: const Offset(0, 1),
              end: Offset.zero,
            ).animate(curved),
            child: child,
          );
        },
      );
  }
}
