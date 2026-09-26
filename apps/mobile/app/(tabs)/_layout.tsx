import React, { useCallback } from "react"
import { Tabs, useRouter } from "expo-router"

import { SideNavInsetContext, useSideNavWidth } from "@/hooks/use-layout"
import { StudyTabBar } from "@/components/navigation/StudyTabBar"

export default function TabLayout() {
  const router = useRouter()
  // 0 on phones and portrait tablets (bottom bar), the rail or sidebar width
  // from 1024pt up. Tab screens read it through the context to measure the
  // space beside the navigation rather than the whole window.
  const sideNavWidth = useSideNavWidth()

  // The Study button starts a session rather than switching section, so it
  // pushes onto the root stack instead of emitting a tabPress.
  const handlePressStudy = useCallback(() => {
    router.push("/mode")
  }, [router])

  return (
    <SideNavInsetContext.Provider value={sideNavWidth}>
      <Tabs
        tabBar={(props) => (
          <StudyTabBar {...props} onPressStudy={handlePressStudy} />
        )}
        screenOptions={{
          headerShown: false,
          lazy: true,
          freezeOnBlur: true,
          tabBarPosition: sideNavWidth > 0 ? "left" : "bottom",
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Home" }} />
        <Tabs.Screen name="learn" options={{ title: "Learn" }} />
        <Tabs.Screen name="community" options={{ title: "Forum" }} />
        <Tabs.Screen name="profile" options={{ title: "Profile" }} />

        {/*
          Updates keeps its route but leaves the bottom bar: `href: null`
          removes the tab without unregistering the screen, so the Home bell
          can still push to it and any deep link into /news keeps working. The
          side navigation on wide screens lists it, because it has the room.
        */}
        <Tabs.Screen name="news" options={{ title: "Updates", href: null }} />
      </Tabs>
    </SideNavInsetContext.Provider>
  )
}
