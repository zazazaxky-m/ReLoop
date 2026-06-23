import 'package:flutter/material.dart';
import '../../theme/colors.dart';

class ReLoopSearchBar extends StatelessWidget {
  final String hintText;
  final ValueChanged<String> onChanged;
  final VoidCallback? onClear;
  final TextEditingController? controller;

  const ReLoopSearchBar({
    super.key,
    this.hintText = 'Cari...',
    required this.onChanged,
    this.onClear,
    this.controller,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: context.reloopBorder),
      ),
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        decoration: InputDecoration(
          hintText: hintText,
          prefixIcon: Icon(Icons.search, size: 20, color: context.reloopMutedSoft),
          suffixIcon: controller != null && controller!.text.isNotEmpty
              ? IconButton(
                  icon: Icon(Icons.clear, size: 18, color: context.reloopMutedSoft),
                  onPressed: () {
                    controller!.clear();
                    onChanged('');
                    onClear?.call();
                  },
                )
              : null,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(vertical: 12),
        ),
      ),
    );
  }
}
