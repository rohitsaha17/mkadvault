"use client";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfile } from "@/app/[locale]/(dashboard)/settings/actions";
import { profileSchema, type ProfileFormValues } from "@/lib/validations/settings";
import type { Profile } from "@/lib/types/database";

interface Props {
  profile: Profile;
  email: string;
}

export function ProfileForm({ profile, email }: Props) {
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      full_name: profile.full_name ?? "",
      phone: profile.phone ?? "",
    },
  });

  function onSubmit(values: ProfileFormValues) {
    startTransition(async () => {
      const res = await updateProfile(values);
      if (res.error) toast.error(res.error);
      else toast.success("Profile updated");
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full Name</Label>
          <Input
            id="fullName"
            {...register("full_name")}
            placeholder="Your name"
          />
          {errors.full_name && (
            <p className="text-xs text-destructive">{errors.full_name.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={email} disabled className="opacity-60" />
          <p className="text-xs text-muted-foreground">Email cannot be changed here.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            {...register("phone")}
            placeholder="+91 98765 43210"
          />
          {errors.phone && (
            <p className="text-xs text-destructive">{errors.phone.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label>Role</Label>
          <Input value={profile.role?.replace(/_/g, " ")} disabled className="opacity-60 capitalize" />
          <p className="text-xs text-muted-foreground">Role is assigned by your organisation admin.</p>
        </div>
      </div>
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Save Profile
      </Button>
    </form>
  );
}
