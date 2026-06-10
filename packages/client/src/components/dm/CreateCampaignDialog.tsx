import { useState, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogHeader } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ApiRequestError } from '../../lib/api';

interface CreateCampaignDialogProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void>;
}

export function CreateCampaignDialog({ open, onClose, onCreate }: CreateCampaignDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setLoading(true);
    try {
      await onCreate(name.trim(), description.trim());
      setName('');
      setDescription('');
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError('Failed to create campaign');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogContent title="New Campaign">
        <DialogHeader title="New Campaign" />
        <form onSubmit={(e) => { void handleSubmit(e); }}>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-name">Campaign Name</Label>
              <Input
                id="campaign-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                placeholder="The Lost Mines of…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-desc">Description <span className="text-zinc-500 font-normal">(optional)</span></Label>
              <Input
                id="campaign-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={loading}
                placeholder="A short description"
              />
            </div>
            {error && (
              <div role="alert" className="text-sm text-red-400 bg-red-950/50 border border-red-900 rounded-md p-3">
                {error}
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={onClose} disabled={loading} className="flex-1">
                Cancel
              </Button>
              <Button type="submit" loading={loading} className="flex-1">
                Create
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
