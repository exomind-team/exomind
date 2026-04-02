import { describe, it, expect } from 'vitest';

// Simple import tests for shadcn components
// These tests verify that components exist and can be imported

describe('shadcn components', () => {
  describe('Button', () => {
    it('should be importable', async () => {
      const { Button } = await import('@/components/ui/button');
      expect(Button).toBeDefined();
      // React.forwardRef returns an object with displayName
      expect(Button.displayName).toBe('Button');
    });
  });

  describe('Card', () => {
    it('should be importable', async () => {
      const { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent } = await import('@/components/ui/card');
      expect(Card).toBeDefined();
      expect(CardHeader).toBeDefined();
      expect(CardFooter).toBeDefined();
      expect(CardTitle).toBeDefined();
      expect(CardDescription).toBeDefined();
      expect(CardContent).toBeDefined();
      expect(Card.displayName).toBe('Card');
    });
  });

  describe('Input', () => {
    it('should be importable', async () => {
      const { Input } = await import('@/components/ui/input');
      expect(Input).toBeDefined();
      expect(Input.displayName).toBe('Input');
    });
  });

  describe('Switch', () => {
    it('should be importable', async () => {
      const { Switch } = await import('@/components/ui/switch');
      expect(Switch).toBeDefined();
      expect(Switch.displayName).toBe('Switch');
    });
  });

  describe('Label', () => {
    it('should be importable', async () => {
      const { Label } = await import('@/components/ui/label');
      expect(Label).toBeDefined();
      expect(Label.displayName).toBe('Label');
    });
  });

  describe('Tabs', () => {
    it('should be importable', async () => {
      const { Tabs, TabsList, TabsTrigger, TabsContent } = await import('@/components/ui/tabs');
      expect(Tabs).toBeDefined();
      expect(TabsList).toBeDefined();
      expect(TabsTrigger).toBeDefined();
      expect(TabsContent).toBeDefined();
    });
  });

  describe('Select', () => {
    it('should be importable', async () => {
      const {
        Select,
        SelectTrigger,
        SelectValue,
        SelectContent,
        SelectItem,
      } = await import('@/components/ui/select');
      expect(Select).toBeDefined();
      expect(SelectTrigger).toBeDefined();
      expect(SelectValue).toBeDefined();
      expect(SelectContent).toBeDefined();
      expect(SelectItem).toBeDefined();
    });
  });

  describe('PageShell and PageTabs', () => {
    it('should be importable', async () => {
      const { PageShell } = await import('@/ui/app/components/PageShell');
      const { PageTabs } = await import('@/ui/app/components/PageTabs');
      expect(PageShell).toBeDefined();
      expect(PageTabs).toBeDefined();
    });
  });

  describe('Badge', () => {
    it('should be importable', async () => {
      const { Badge } = await import('@/components/ui/badge');
      expect(Badge).toBeDefined();
      expect(Badge).toBeInstanceOf(Function);
    });
  });

  describe('Dialog', () => {
    it('should be importable', async () => {
      const { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription, DialogClose } = await import('@/components/ui/dialog');
      expect(Dialog).toBeDefined();
      expect(DialogTrigger).toBeDefined();
      expect(DialogContent).toBeDefined();
      expect(DialogHeader).toBeDefined();
      expect(DialogFooter).toBeDefined();
      expect(DialogTitle).toBeDefined();
      expect(DialogDescription).toBeDefined();
      expect(DialogClose).toBeDefined();
    });
  });

  describe('Toast', () => {
    it('should be importable', async () => {
      const { Toast, Toaster, useToast } = await import('@/components/ui');
      expect(Toast).toBeDefined();
      expect(Toaster).toBeDefined();
      expect(useToast).toBeDefined();
    });
  });

  describe('Avatar', () => {
    it('should be importable', async () => {
      const { Avatar, AvatarImage, AvatarFallback } = await import('@/components/ui/avatar');
      expect(Avatar).toBeDefined();
      expect(AvatarImage).toBeDefined();
      expect(AvatarFallback).toBeDefined();
      expect(Avatar.displayName).toBe('Avatar');
    });
  });
});
