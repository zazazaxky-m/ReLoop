import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/connectivity_provider.dart';
import '../../theme/colors.dart';

class NetworkAwareWidget extends StatelessWidget {
  final Widget child;

  const NetworkAwareWidget({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final isOnline = context.watch<ConnectivityProvider>().isOnline;

    return Column(
      children: [
        if (!isOnline) _buildOfflineBanner(),
        Expanded(child: child),
      ],
    );
  }

  Widget _buildOfflineBanner() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      color: ReLoopColors.warning,
      child: const SafeArea(
        bottom: false,
        child: Row(
          children: [
            Icon(Icons.wifi_off, color: Colors.white, size: 16),
            SizedBox(width: 8),
            Expanded(
              child: Text(
                'Tidak ada koneksi internet. Data ditampilkan dari cache.',
                style: TextStyle(color: Colors.white, fontSize: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
