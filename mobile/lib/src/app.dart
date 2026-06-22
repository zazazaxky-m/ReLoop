import 'package:flutter/material.dart';

import 'api_client.dart';
import 'auth_screen.dart';
import 'models.dart';
import 'shell.dart';
import 'theme.dart';

class ReLoopApp extends StatefulWidget {
  const ReLoopApp({super.key, required this.api});
  final ApiClient api;

  @override
  State<ReLoopApp> createState() => _ReLoopAppState();
}

class _ReLoopAppState extends State<ReLoopApp> {
  AppUser? _user;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    if (widget.api.hasSession) {
      try {
        final data = await widget.api.get('/api/auth/me');
        _user = AppUser.fromJson(data['user'] as Map<String, dynamic>);
      } catch (_) {
        await widget.api.clearSession();
      }
    }
    if (mounted) setState(() => _loading = false);
  }

  void _signedIn(AppUser user) => setState(() => _user = user);

  Future<void> _signedOut() async {
    try {
      await widget.api.post('/api/auth/logout');
    } finally {
      await widget.api.clearSession();
      if (mounted) setState(() => _user = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ReLoop',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: _loading
          ? const _Splash()
          : _user == null
          ? AuthScreen(api: widget.api, onSignedIn: _signedIn)
          : AppShell(api: widget.api, user: _user!, onSignOut: _signedOut),
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) => const Scaffold(
    body: Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.recycling_rounded, size: 72, color: brandGreen),
          SizedBox(height: 16),
          Text(
            'ReLoop',
            style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800),
          ),
          SizedBox(height: 24),
          CircularProgressIndicator(),
        ],
      ),
    ),
  );
}
