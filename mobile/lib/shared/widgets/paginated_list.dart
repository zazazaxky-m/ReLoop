import 'package:flutter/material.dart';
import '../../core/api_client.dart';
import '../../theme/colors.dart';

class PaginatedList<T> extends StatefulWidget {
  final Future<PaginatedResult<T>> Function(String? cursor) fetcher;
  final Widget Function(T item) itemBuilder;
  final Widget? emptyState;
  final Widget Function()? loadingState;
  final EdgeInsetsGeometry? padding;
  final ScrollController? scrollController;

  const PaginatedList({
    super.key,
    required this.fetcher,
    required this.itemBuilder,
    this.emptyState,
    this.loadingState,
    this.padding,
    this.scrollController,
  });

  @override
  State<PaginatedList<T>> createState() => _PaginatedListState<T>();
}

class PaginatedResult<T> {
  final List<T> items;
  final String? nextCursor;
  final bool hasMore;

  PaginatedResult({required this.items, this.nextCursor, this.hasMore = false});
}

class _PaginatedListState<T> extends State<PaginatedList<T>> {
  final List<T> _items = [];
  String? _nextCursor;
  bool _hasMore = true;
  bool _isLoading = false;
  bool _isInitialLoading = true;
  String? _error;
  late ScrollController _scrollController;

  @override
  void initState() {
    super.initState();
    _scrollController = widget.scrollController ?? ScrollController();
    if (widget.scrollController == null) {
      _scrollController.addListener(_onScroll);
    }
    _loadMore();
  }

  @override
  void dispose() {
    if (widget.scrollController == null) {
      _scrollController.removeListener(_onScroll);
      _scrollController.dispose();
    }
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
            _scrollController.position.maxScrollExtent - 200 &&
        !_isLoading &&
        _hasMore) {
      _loadMore();
    }
  }

  Future<void> _loadMore() async {
    if (_isLoading || !_hasMore) return;

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final result = await widget.fetcher(_nextCursor);
      if (!mounted) return;
      setState(() {
        _items.addAll(result.items);
        _nextCursor = result.nextCursor;
        _hasMore = result.hasMore;
        _isLoading = false;
        _isInitialLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = ApiClient.getErrorMessage(e);
        _isLoading = false;
        _isInitialLoading = false;
      });
    }
  }

  Future<void> refresh() async {
    setState(() {
      _items.clear();
      _nextCursor = null;
      _hasMore = true;
      _isInitialLoading = true;
      _error = null;
    });
    await _loadMore();
  }

  @override
  Widget build(BuildContext context) {
    if (_isInitialLoading) {
      return widget.loadingState != null
          ? widget.loadingState!()
          : const Center(child: CircularProgressIndicator());
    }

    if (_error != null && _items.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off, size: 48, color: context.reloopMutedSoft),
            const SizedBox(height: 12),
            Text(_error!, style: TextStyle(color: context.reloopMuted)),
            const SizedBox(height: 12),
            TextButton(onPressed: refresh, child: Text('Coba Lagi')),
          ],
        ),
      );
    }

    if (_items.isEmpty && widget.emptyState != null) {
      return widget.emptyState!;
    }

    return RefreshIndicator(
      onRefresh: refresh,
      child: ListView.builder(
        controller: _scrollController,
        padding: widget.padding ?? const EdgeInsets.all(16),
        itemCount: _items.length + (_hasMore ? 1 : 0),
        itemBuilder: (context, index) {
          if (index == _items.length) {
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            );
          }
          return widget.itemBuilder(_items[index]);
        },
      ),
    );
  }
}
