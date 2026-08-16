import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { ActivityIndicator, View } from "react-native";
import { OcrFields } from "../api/client";
import { useAuth } from "../context/AuthContext";
import LoginScreen from "../screens/LoginScreen";
import NewWorkerDetailsScreen from "../screens/NewWorkerDetailsScreen";
import NewWorkerScanScreen from "../screens/NewWorkerScanScreen";
import PlaceholderScreen from "../screens/PlaceholderScreen";
import WorkerListScreen from "../screens/WorkerListScreen";

export type RootStackParamList = {
  Dashboard: undefined;
  WorkerList: undefined;
  NewWorkerScan: undefined;
  NewWorkerDetails: { ocrFields: OcrFields };
  MarkAttendance: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { token, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!token) {
    return <LoginScreen />;
  }

  return (
    <NavigationContainer>
      {/* WorkerList, not Dashboard, is the entry point today -- Dashboard
          has no functionality until Day 4 and would be a dead end with
          no way to reach the screens that actually exist. Revert once
          Dashboard is real. */}
      <Stack.Navigator initialRouteName="WorkerList">
        <Stack.Screen name="Dashboard" options={{ title: "Dashboard" }}>
          {() => <PlaceholderScreen title="Dashboard" day="Day 4" />}
        </Stack.Screen>
        <Stack.Screen name="WorkerList" component={WorkerListScreen} options={{ title: "Workers" }} />
        <Stack.Screen name="NewWorkerScan" component={NewWorkerScanScreen} options={{ title: "New Worker" }} />
        <Stack.Screen
          name="NewWorkerDetails"
          component={NewWorkerDetailsScreen}
          options={{ title: "Worker Details" }}
        />
        <Stack.Screen name="MarkAttendance" options={{ title: "Mark Attendance" }}>
          {() => <PlaceholderScreen title="Mark Attendance" day="Day 4" />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}
