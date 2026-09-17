"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { sendNotificationMessage } from "@/lib/actions/cms";

export function NotificationForm() {
  const [channel, setChannel] = React.useState("push");

  return (
    <form action={sendNotificationMessage} className="mt-2 space-y-4">
      <input type="hidden" name="channel" value={channel} />

      <div className="space-y-2">
        <Label htmlFor="channel">Channel</Label>
        <Select
          value={channel}
          onValueChange={(value) => setChannel(value ?? "push")}
        >
          <SelectTrigger id="channel">
            <SelectValue placeholder="Select a channel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="push">Push</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="sms">SMS</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="subject">Subject or Title</Label>
        <Input
          id="subject"
          name="subject"
          placeholder="Premium access updated"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="content">Content</Label>
        <Textarea
          id="content"
          name="content"
          rows={5}
          required
          placeholder="Type the message body..."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="users">Users</Label>
          <Textarea
            id="users"
            name="users"
            rows={3}
            placeholder="One user ID per line"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="topics">Topics</Label>
          <Textarea
            id="topics"
            name="topics"
            rows={3}
            placeholder="One topic ID per line"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="targets">Targets</Label>
        <Textarea
          id="targets"
          name="targets"
          rows={3}
          placeholder="Optional target IDs for device- or channel-specific delivery"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="scheduledAt">Schedule</Label>
        <Input id="scheduledAt" type="datetime-local" name="scheduledAt" />
      </div>

      <Button type="submit" size="lg" className="rounded-full">
        Queue message
      </Button>
    </form>
  );
}
