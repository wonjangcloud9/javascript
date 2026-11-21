import type { SignUpNextStep } from '@clerk/shared/internal/clerk-js/nextStep';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { usePendingAction } from '../../hooks/use-pending-action';
import type { ErrorDescription } from '../../localization';
import { useErrorText } from '../../localization';
import { setup } from '../../machine/setup';
import type { ErrorInvokeEvent } from '../../machine/types';
import { useMachine } from '../../machine/use-machine';
import type { MosaicLocationOptions } from '../../routing/use-mosaic-location';
import { useRouteGuard } from '../../routing/use-route-guard';
import { useRouterScope } from '../../routing/use-router';
import { toLocalizableError } from '../../utils/errors';
import type { SignUpFlowModel, SignUpReadyModel } from './sign-up.model';
import type { SignUpRoute } from './sign-up.routes';
import { detailsRouteFor, routeFor, shownRoute, signUpRoutes } from './sign-up.routes';
import type { SignUpProtectScreen, SignUpScreen, SignUpVerifyScreen, SignUpViewProps } from './sign-up.types';
import { useSignUpDetailsController } from './sign-up-details/sign-up-details.controller';

interface FinishContext {
  frozenModel: SignUpReadyModel | null;
  isNextScreenLoading: boolean;
  error: ErrorDescription | undefined;
}

type FinishEvent = { type: 'FINISH'; frozenModel: SignUpReadyModel };

const finish = setup<FinishContext, FinishEvent>();

const startFinishing = {
  FINISH: {
    target: 'finishing' as const,
    actions: finish.assign<FinishEvent>((_, event) => ({ frozenModel: event.frozenModel, error: undefined })),
  },
};

const finishMachine = finish.createMachine({
  id: 'signUpFinish',
  initial: 'idle',
  context: {
    frozenModel: null,
    isNextScreenLoading: false,
    error: undefined,
  },
  states: {
    idle: {
      on: startFinishing,
    },
    finishing: {
      invoke: finish.fromPromise(context => context.frozenModel?.flow.finalize() ?? Promise.resolve(), {
        onDone: { target: 'handingOff' },
        onError: {
          target: 'idle',
          actions: finish.assign<ErrorInvokeEvent>((_, event) => ({
            frozenModel: null,
            error: toLocalizableError(event.error),
          })),
        },
      }),
    },
    handingOff: {
      always: {
        guard: context => !context.isNextScreenLoading,
        target: 'finished',
        actions: finish.assign(() => ({ frozenModel: null })),
      },
    },
    finished: {
      on: startFinishing,
    },
  },
});

function screenFor(route: SignUpRoute | undefined, flow: SignUpFlowModel): SignUpScreen {
  if (route === undefined || route === 'enterpriseConnections') {
    return 'startOver';
  }
  if (flow.actionBlocked && (route === 'start' || route === 'protectCheck' || route === 'continueProtectCheck')) {
    return 'actionBlocked';
  }
  if (route !== 'start') {
    return route;
  }
  return flow.mode === 'public' || flow.ticket ? 'start' : flow.mode;
}

type SignUpControllerResult =
  | { status: 'hidden' }
  | (Omit<
      SignUpViewProps,
      'applicationName' | 'logo' | 'taskChooseOrganization' | 'verifyEmail' | 'verifyPhone' | 'protectCheck'
    > & {
      status: 'ready';
      attempt?: string;
      verifyEmail: SignUpVerifyScreen;
      verifyPhone: SignUpVerifyScreen;
      protectCheck: SignUpProtectScreen;
    });

export function useSignUpController(
  liveModel: SignUpReadyModel,
  { isTaskReady, ...options }: MosaicLocationOptions & { isTaskReady: boolean },
): SignUpControllerResult {
  const { route, go } = useRouterScope(signUpRoutes, { ...options, root: 'start' });
  const actions = usePendingAction<'startOver' | 'ticket' | 'return'>();
  const redeemedTicket = useRef<string | undefined>(undefined);
  const completedReturn = useRef(false);
  const errorText = useErrorText();
  const liveStep = liveModel.flow.step;
  const isNextScreenLoading = liveStep.type === 'leaving' || (liveStep.type === 'task' && !isTaskReady);
  const [finishSnapshot, sendFinish, finishActor] = useMachine(finishMachine, { context: { isNextScreenLoading } });
  // Finishing this sign-up also reaches `signed_in`, so only the step at mount marks a visit by a signed-in user.
  // `leave` is kept from mount so the visit leaves once. Only single-session mode has it.
  const [signedInVisit] = useState(() => (liveStep.type === 'signed_in' ? { leave: liveModel.flow.leave } : undefined));
  const arrivedSignedIn = signedInVisit !== undefined;
  const leavesOnArrival = signedInVisit?.leave !== undefined;

  useEffect(() => signedInVisit?.leave?.(), [signedInVisit]);

  // TODO: If a second feature needs `recheck()` after its injected context changes, propose an opt-in recheck in
  // `useMachine`, in its own PR, so both controllers drop this effect.
  useLayoutEffect(() => {
    finishActor.recheck();
  }, [isNextScreenLoading, finishActor]);

  const model = finishSnapshot.context.frozenModel ?? liveModel;
  const { flow, navigation, verification } = model;
  const isFinishing = finishSnapshot.value === 'finishing' || finishSnapshot.value === 'handingOff';
  const isHidden = liveStep.type === 'signed_in' && (leavesOnArrival || finishSnapshot.value === 'finished');
  const shown = shownRoute(route, flow.step.type === 'signed_in' && !arrivedSignedIn ? { type: 'leaving' } : flow.step);
  const screen =
    actions.pendingKey === 'ticket' || actions.pendingKey === 'return' ? 'loading' : screenFor(shown, flow);

  useRouteGuard({ route, go }, shown);

  // TODO: With a URL routing mode (#10860) a reload can mount on a sign-up that is already complete. Finalize it
  // here, once per mount.
  const next = (nextStep: SignUpNextStep) => {
    if (nextStep.type === 'complete') {
      sendFinish({ type: 'FINISH', frozenModel: model });
      return;
    }
    const nextRoute = routeFor(nextStep, route);
    if (nextRoute) {
      go(nextRoute);
    }
  };

  const finishError = finishSnapshot.context.error ? errorText(finishSnapshot.context.error) : undefined;
  const flowError = finishError ?? actions.error;
  const details = useSignUpDetailsController(model.details, {
    purpose: screen === 'continue' ? 'continue' : 'start',
    isBusy: actions.isPending || isFinishing,
    globalErrorMessage: flowError,
    onSubmit: actions.reset,
    onNext: next,
    onSignIn: navigation.goToSignIn,
  });
  /* eslint-disable react-you-might-not-need-an-effect/no-event-handler -- Completes an OAuth return, or redeems an invitation, once when sign-up opens on start with its marker or ticket in the URL; arriving from a redirect or a link is not an event a handler could run from. */
  useEffect(() => {
    if (flow.isReturning && route === 'start' && !completedReturn.current) {
      completedReturn.current = true;
      void actions.run('return', async () => {
        const step = await flow.completeReturn();
        if (step) {
          next(step);
        }
      });
      return;
    }
    if (
      flow.isReturning ||
      !flow.ticket ||
      flow.inTicketSignUp ||
      route !== 'start' ||
      redeemedTicket.current === flow.ticket
    ) {
      return;
    }
    redeemedTicket.current = flow.ticket;
    void actions.run('ticket', async () => {
      const { step, emailAddress } = await flow.redeemTicket();
      details.adoptInvitation(emailAddress);
      next(step);
    });
  });
  /* eslint-enable react-you-might-not-need-an-effect/no-event-handler */

  const verify = {
    onNext: next,
    isPending: isFinishing,
    globalErrorMessage: finishError,
    onEditIdentifier: () => {
      details.leaveChannel();
      go(detailsRouteFor(route));
    },
  };

  if (isHidden) {
    return { status: 'hidden' };
  }

  return {
    status: 'ready',
    screen: screen === 'start' && details.alternativePhone ? 'alternativePhone' : screen,
    attempt: flow.signUpId,
    alternativePhone: details.alternativePhone,
    start: details.start,
    continue: details.continue,
    verifyEmail: { ...verify, verification: verification.email },
    verifyPhone: { ...verify, verification: verification.phone },
    protectCheck: { protect: model.protect, onNext: next },
    restricted: {
      globalErrorMessage: details.error ?? flowError,
      onEmailSupport: navigation.emailSupport,
      onJoinWaitlist: navigation.joinWaitlist,
      onSignIn: navigation.goToSignIn,
    },
    actionBlocked: flow.actionBlocked,
    startOver: {
      isPending: actions.isPending,
      globalErrorMessage: actions.error,
      onStartOver: () =>
        void actions.run('startOver', async () => {
          await flow.reset();
          details.reset();
          go('start');
        }),
    },
  };
}
